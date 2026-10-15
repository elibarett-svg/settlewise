from collections import defaultdict
from datetime import date, timedelta
from typing import Any

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ...core import events
from ...core.db import utcnow
from ...core.models import LifeEvent
from .models import CLOSED_STATUSES, Task, TaskDependency


def dependency_map(db: Session, task_ids: list[str]) -> dict[str, list[str]]:
    if not task_ids:
        return {}
    rows = db.scalars(select(TaskDependency).where(TaskDependency.task_id.in_(task_ids))).all()
    out: dict[str, list[str]] = defaultdict(list)
    for row in rows:
        out[row.task_id].append(row.depends_on_id)
    return out


def blocked_by(db: Session, tasks: list[Task]) -> dict[str, list[str]]:
    """task id -> ids of unfinished prerequisites."""
    deps = dependency_map(db, [t.id for t in tasks])
    needed = {d for ds in deps.values() for d in ds}
    status = {t.id: t.status for t in tasks}
    missing = needed - status.keys()
    if missing:
        for t in db.scalars(select(Task).where(Task.id.in_(missing))):
            status[t.id] = t.status
    return {tid: [d for d in ds if status.get(d) not in CLOSED_STATUSES] for tid, ds in deps.items()}


def would_create_cycle(db: Session, task_id: str, depends_on_id: str) -> bool:
    """Adding task -> depends_on is a cycle if task is reachable from depends_on."""
    seen, stack = set(), [depends_on_id]
    while stack:
        current = stack.pop()
        if current == task_id:
            return True
        if current in seen:
            continue
        seen.add(current)
        stack.extend(db.scalars(select(TaskDependency.depends_on_id).where(TaskDependency.task_id == current)).all())
    return False


def add_dependency(db: Session, task: Task, depends_on: Task) -> None:
    if task.id == depends_on.id or would_create_cycle(db, task.id, depends_on.id):
        raise HTTPException(409, "That link would create a loop of tasks waiting on each other")
    exists = db.scalar(
        select(TaskDependency).where(TaskDependency.task_id == task.id, TaskDependency.depends_on_id == depends_on.id)
    )
    if not exists:
        db.add(TaskDependency(task_id=task.id, depends_on_id=depends_on.id))
        db.flush()


def generate_from_template(db: Session, life_event: LifeEvent, specs: list[dict[str, Any]]) -> list[Task]:
    """2.2 Generate Action Plan - create tasks and their dependencies from a template."""
    by_key: dict[str, Task] = {}
    ordered = sorted(enumerate(specs), key=lambda p: (p[1].get("offset_days", 0), p[0]))
    for position, (_, spec) in enumerate(ordered):
        offset = spec.get("offset_days")
        task = Task(
            user_id=life_event.user_id,
            life_event_id=life_event.id,
            title=spec["title"],
            description=spec.get("description", ""),
            category=spec.get("category", "general"),
            priority=spec.get("priority", "medium"),
            owner=spec.get("owner", "me"),
            due_date=life_event.key_date + timedelta(days=offset) if offset is not None else None,
            position=position,
            template_key=spec["key"],
            offset_days=offset,
            date_sensitive=bool(spec.get("date_sensitive")),
            external_party=spec.get("external_party", ""),
            guidance=spec.get("guidance", ""),
            source_ids=list(spec.get("source_ids", [])),
        )
        db.add(task)
        by_key[spec["key"]] = task
    db.flush()
    for spec in specs:
        for dep_key in spec.get("depends_on", []) or []:
            if dep_key in by_key and spec["key"] in by_key:
                db.add(TaskDependency(task_id=by_key[spec["key"]].id, depends_on_id=by_key[dep_key].id))
    db.flush()
    for task in by_key.values():
        events.bus.publish(db, events.TASK_SAVED, {"task": task})
    return list(by_key.values())


def mark_status(db: Session, task: Task, status: str) -> None:
    task.status = status
    task.completed_at = utcnow() if status in CLOSED_STATUSES else None


def event_tasks(db: Session, life_event_id: str) -> list[Task]:
    return list(
        db.scalars(select(Task).where(Task.life_event_id == life_event_id).order_by(Task.position, Task.due_date))
    )


def progress(db: Session, life_event_id: str, today: date | None = None) -> dict[str, Any]:
    """2.4 View Plan Progress. The completion score always ships with its denominator,
    overdue and blocked counts so it cannot be read as an eligibility score (Appendix D)."""
    today = today or date.today()
    tasks = event_tasks(db, life_event_id)
    blocked = blocked_by(db, tasks)
    counts = {"completed": 0, "upcoming": 0, "overdue": 0, "blocked": 0, "needs_review": 0, "skipped": 0}
    for t in tasks:
        if t.status == "done":
            counts["completed"] += 1
        elif t.status == "skipped":
            counts["skipped"] += 1
        elif blocked.get(t.id):
            counts["blocked"] += 1
        elif t.status == "needs_review":
            counts["needs_review"] += 1
        elif t.due_date and t.due_date < today:
            counts["overdue"] += 1
        else:
            counts["upcoming"] += 1
    total = len(tasks) - counts["skipped"]
    next_task = next(
        (t for t in tasks if t.status not in CLOSED_STATUSES and not blocked.get(t.id)),
        None,
    )
    return {
        **counts,
        "total": total,
        "completion_percent": round(100 * counts["completed"] / total) if total else 0,
        "score_note": "Task completion only - not an eligibility or settlement-success estimate.",
        "next_task_id": next_task.id if next_task else None,
        "next_task_title": next_task.title if next_task else None,
    }


def search(
    db: Session,
    user_id: str,
    *,
    life_event_id: str | None = None,
    status: str | None = None,
    owner: str | None = None,
    category: str | None = None,
    due_from: date | None = None,
    due_to: date | None = None,
    q: str | None = None,
) -> list[Task]:
    """4.5 View Task List. ``status`` also accepts the computed views overdue, blocked and open."""
    stmt = select(Task).where(Task.user_id == user_id)
    if life_event_id:
        stmt = stmt.where(Task.life_event_id == life_event_id)
    if owner:
        stmt = stmt.where(Task.owner == owner)
    if category:
        stmt = stmt.where(Task.category == category)
    if due_from:
        stmt = stmt.where(Task.due_date >= due_from)
    if due_to:
        stmt = stmt.where(Task.due_date <= due_to)
    if q:
        stmt = stmt.where(or_(Task.title.ilike(f"%{q}%"), Task.description.ilike(f"%{q}%")))
    if status in ("todo", "in_progress", "needs_review", "done", "skipped"):
        stmt = stmt.where(Task.status == status)
    elif status in ("open", "overdue", "blocked"):
        stmt = stmt.where(Task.status.not_in(CLOSED_STATUSES))
    stmt = stmt.order_by(Task.due_date.is_(None), Task.due_date, Task.position)
    tasks = list(db.scalars(stmt))
    if status == "overdue":
        tasks = [t for t in tasks if t.due_date and t.due_date < date.today()]
    elif status == "blocked":
        blocked = blocked_by(db, tasks)
        tasks = [t for t in tasks if blocked.get(t.id)]
    return tasks
