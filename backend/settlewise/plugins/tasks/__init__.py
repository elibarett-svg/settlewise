"""4.0 Task & Dependency Management, including event impact analysis (4.4)."""

from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...core import events
from ...core.db import get_db
from ...core.deps import get_current_user, get_owned
from ...core.models import LifeEvent, User
from ...core.plugin import ImpactItem, Plugin, registry
from ...core.util import delete_rows
from . import service
from .models import CLOSED_STATUSES, STATUSES, ImpactReview, Task, TaskDependency

PRIORITY = "^(low|medium|high)$"


class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str = ""
    life_event_id: str | None = None
    category: str = "general"
    owner: str = "me"
    priority: str = Field(default="medium", pattern=PRIORITY)
    due_date: date | None = None
    external_party: str = ""
    date_sensitive: bool = False


class TaskPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    category: str | None = None
    owner: str | None = None
    priority: str | None = Field(default=None, pattern=PRIORITY)
    status: str | None = None
    due_date: date | None = None
    external_party: str | None = None
    date_sensitive: bool | None = None


class TaskOut(BaseModel):
    id: str
    life_event_id: str | None
    title: str
    description: str
    category: str
    owner: str
    priority: str
    status: str
    due_date: date | None
    position: int
    date_sensitive: bool
    external_party: str
    guidance: str
    source_ids: list[str]
    offset_days: int | None
    depends_on: list[str] = []
    blocked_by: list[str] = []
    overdue: bool = False


class ReorderIn(BaseModel):
    life_event_id: str
    task_ids: list[str]


class DependencyIn(BaseModel):
    depends_on_id: str


class ImpactPreviewIn(BaseModel):
    life_event_id: str
    new_key_date: date


class ImpactApplyIn(BaseModel):
    approved_item_ids: list[str]


class ImpactReviewOut(BaseModel):
    id: str
    life_event_id: str
    old_date: date
    new_date: date
    delta_days: int
    status: str
    items: list[ImpactItem]
    approved_item_ids: list[str]
    summary: dict[str, int]


def to_out(db: Session, tasks: list[Task]) -> list[TaskOut]:
    deps = service.dependency_map(db, [t.id for t in tasks])
    blocked = service.blocked_by(db, tasks)
    today = date.today()
    return [
        TaskOut(
            id=t.id,
            life_event_id=t.life_event_id,
            title=t.title,
            description=t.description,
            category=t.category,
            owner=t.owner,
            priority=t.priority,
            status=t.status,
            due_date=t.due_date,
            position=t.position,
            date_sensitive=t.date_sensitive,
            external_party=t.external_party,
            guidance=t.guidance,
            source_ids=t.source_ids or [],
            offset_days=t.offset_days,
            depends_on=deps.get(t.id, []),
            blocked_by=blocked.get(t.id, []),
            overdue=bool(t.due_date and t.due_date < today and t.status not in CLOSED_STATUSES),
        )
        for t in tasks
    ]


def review_out(review: ImpactReview) -> ImpactReviewOut:
    items = [ImpactItem(**i) for i in review.items]
    summary: dict[str, int] = {}
    for item in items:
        summary[item.category] = summary.get(item.category, 0) + 1
    return ImpactReviewOut(
        id=review.id,
        life_event_id=review.life_event_id,
        old_date=review.old_date,
        new_date=review.new_date,
        delta_days=(review.new_date - review.old_date).days,
        status=review.status,
        items=items,
        approved_item_ids=review.approved_item_ids or [],
        summary=summary,
    )


def build_router() -> APIRouter:
    r = APIRouter(tags=["4.0 Tasks"])

    @r.get("/tasks", response_model=list[TaskOut], summary="4.5 View Task List")
    def list_tasks(
        life_event_id: str | None = None,
        status: str | None = Query(
            default=None, description="todo|in_progress|needs_review|done|skipped|open|overdue|blocked"
        ),
        owner: str | None = None,
        category: str | None = None,
        due_from: date | None = None,
        due_to: date | None = None,
        q: str | None = None,
        user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ):
        tasks = service.search(
            db,
            user.id,
            life_event_id=life_event_id,
            status=status,
            owner=owner,
            category=category,
            due_from=due_from,
            due_to=due_to,
            q=q,
        )
        return to_out(db, tasks)

    @r.post("/tasks", response_model=TaskOut, status_code=201, summary="4.1 Create Tasks / 2.3 add a plan step")
    def create(body: TaskIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        position = 0
        if body.life_event_id:
            get_owned(db, LifeEvent, body.life_event_id, user.id, "Life event")
            position = len(service.event_tasks(db, body.life_event_id))
        task = Task(user_id=user.id, position=position, **body.model_dump())
        db.add(task)
        db.flush()
        events.bus.publish(db, events.TASK_SAVED, {"task": task})
        return to_out(db, [task])[0]

    @r.get("/tasks/{task_id}", response_model=TaskOut)
    def read(task_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        return to_out(db, [get_owned(db, Task, task_id, user.id)])[0]

    @r.patch("/tasks/{task_id}", response_model=TaskOut, summary="4.2 Manage Tasks")
    def update(
        task_id: str,
        body: TaskPatch,
        force: bool = False,
        user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ):
        task = get_owned(db, Task, task_id, user.id)
        data = body.model_dump(exclude_unset=True)
        status = data.pop("status", None)
        if status is not None:
            if status not in STATUSES:
                raise HTTPException(422, f"status must be one of {STATUSES}")
            waiting = service.blocked_by(db, [task]).get(task.id)
            if status in ("in_progress", "done") and waiting and not force:
                titles = [db.get(Task, t).title for t in waiting]
                raise HTTPException(409, {"message": "Finish the prerequisite tasks first", "blocked_by": titles})
            service.mark_status(db, task, status)
        if "due_date" in data:
            task.offset_days = None  # a manual date detaches the task from the key date
        for key, value in data.items():
            setattr(task, key, value)
        events.bus.publish(db, events.TASK_SAVED, {"task": task})
        return to_out(db, [task])[0]

    @r.delete("/tasks/{task_id}", status_code=204, summary="2.3 remove a plan step")
    def delete(task_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        task = get_owned(db, Task, task_id, user.id)
        events.bus.publish(db, events.TASK_DELETED, {"task": task})
        db.delete(task)

    @r.post("/tasks/reorder", response_model=list[TaskOut], summary="2.3 Customize Plan")
    def reorder(body: ReorderIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        get_owned(db, LifeEvent, body.life_event_id, user.id, "Life event")
        tasks = {t.id: t for t in service.event_tasks(db, body.life_event_id)}
        if set(body.task_ids) - tasks.keys():
            raise HTTPException(422, "task_ids must all belong to this life event")
        rest = [t for tid, t in tasks.items() if tid not in body.task_ids]
        for position, task in enumerate([tasks[i] for i in body.task_ids] + rest):
            task.position = position
        return to_out(db, service.event_tasks(db, body.life_event_id))

    @r.post("/tasks/{task_id}/dependencies", response_model=TaskOut, summary="4.3 Link Task Dependencies")
    def link(task_id: str, body: DependencyIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        task = get_owned(db, Task, task_id, user.id)
        service.add_dependency(db, task, get_owned(db, Task, body.depends_on_id, user.id))
        return to_out(db, [task])[0]

    @r.delete("/tasks/{task_id}/dependencies/{depends_on_id}", response_model=TaskOut)
    def unlink(task_id: str, depends_on_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        task = get_owned(db, Task, task_id, user.id)
        dep = db.scalar(
            select(TaskDependency).where(
                TaskDependency.task_id == task.id, TaskDependency.depends_on_id == depends_on_id
            )
        )
        if dep:
            db.delete(dep)
            db.flush()
        return to_out(db, [task])[0]

    # --- 4.4 Review Change Impact --------------------------------------------------
    @r.post("/impact/preview", response_model=ImpactReviewOut, status_code=201, summary="4.4 Review Change Impact")
    def preview(body: ImpactPreviewIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        ev = get_owned(db, LifeEvent, body.life_event_id, user.id, "Life event")
        if ev.status != "active":
            raise HTTPException(409, "This life event is closed")
        if body.new_key_date == ev.key_date:
            raise HTTPException(422, "The new date is the same as the current date")
        for old in db.scalars(
            select(ImpactReview).where(ImpactReview.life_event_id == ev.id, ImpactReview.status == "pending")
        ):
            old.status = "superseded"
        items: list[ImpactItem] = []
        for plugin in registry.all():
            items.extend(plugin.propose_impact(db, ev, ev.key_date, body.new_key_date))
        review = ImpactReview(
            user_id=user.id,
            life_event_id=ev.id,
            old_date=ev.key_date,
            new_date=body.new_key_date,
            items=[i.model_dump(mode="json") for i in items],
        )
        db.add(review)
        db.flush()
        return review_out(review)

    @r.get("/impact", response_model=list[ImpactReviewOut])
    def list_reviews(life_event_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        get_owned(db, LifeEvent, life_event_id, user.id, "Life event")
        rows = db.scalars(
            select(ImpactReview)
            .where(ImpactReview.life_event_id == life_event_id)
            .order_by(ImpactReview.created_at.desc())
        )
        return [review_out(r) for r in rows]

    @r.get("/impact/{review_id}", response_model=ImpactReviewOut)
    def read_review(review_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        return review_out(get_owned(db, ImpactReview, review_id, user.id, "Impact review"))

    @r.post("/impact/{review_id}/apply", response_model=ImpactReviewOut)
    def apply(
        review_id: str, body: ImpactApplyIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ):
        """Change the key date and apply only the items the user approved. Each plugin
        updates its own records; nothing outside the user's plan is changed."""
        review = get_owned(db, ImpactReview, review_id, user.id, "Impact review")
        if review.status != "pending":
            raise HTTPException(409, f"This review is already {review.status}")
        ev = db.get(LifeEvent, review.life_event_id)
        approved = set(body.approved_item_ids)
        items = [ImpactItem(**i) for i in review.items if i["id"] in approved]
        delta = (review.new_date - review.old_date).days
        for plugin in registry.all():
            mine = [i for i in items if i.plugin == plugin.name]
            if mine:
                plugin.apply_impact(db, ev, mine, delta)
        ev.key_date = review.new_date
        review.status = "applied"
        review.approved_item_ids = sorted(approved & {i.id for i in items})
        events.bus.publish(
            db,
            events.LIFE_EVENT_DATE_CHANGED,
            {"life_event": ev, "old_date": review.old_date, "new_date": review.new_date, "delta_days": delta},
        )
        return review_out(review)

    @r.post("/impact/{review_id}/dismiss", response_model=ImpactReviewOut)
    def dismiss(review_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        review = get_owned(db, ImpactReview, review_id, user.id, "Impact review")
        if review.status == "pending":
            review.status = "dismissed"
        return review_out(review)

    return r


def _fmt(d: date | None) -> str | None:
    return d.isoformat() if d else None


class TasksPlugin(Plugin):
    name = "tasks"
    feature_id = "4.0"
    title = "Task & Dependency Management"
    functions = {
        "4.1": "Create Tasks",
        "4.2": "Manage Tasks",
        "4.3": "Link Task Dependencies",
        "4.4": "Review Change Impact",
        "4.5": "View Task List",
    }

    def build_router(self):
        return build_router()

    def setup(self, ctx):
        def on_event_created(db: Session, payload):
            service.generate_from_template(db, payload["life_event"], payload.get("tasks", []))

        ctx.bus.subscribe(events.LIFE_EVENT_CREATED, on_event_created)

    def propose_impact(self, db, life_event, old_date, new_date):
        items: list[ImpactItem] = []
        delta = (new_date - old_date).days
        when = "later" if delta > 0 else "earlier"
        for task in service.event_tasks(db, life_event.id):
            external = bool(task.date_sensitive and task.external_party)
            if task.status in CLOSED_STATUSES:
                if task.date_sensitive:
                    items.append(
                        ImpactItem(
                            plugin=self.name,
                            kind="task",
                            ref_id=task.id,
                            title=task.title,
                            category=task.category,
                            action="review",
                            reason=(
                                "Already done for the old date. "
                                f"Confirm the new date with {task.external_party or 'the provider'}."
                            ),
                            current_value=task.status,
                            proposed_value="needs_review",
                            requires_external_confirmation=external,
                        )
                    )
                continue
            if task.offset_days is None or task.due_date is None:
                continue
            proposed = new_date + timedelta(days=task.offset_days)
            if proposed == task.due_date:
                continue
            reason = f"Linked to the key date, which moves {abs(delta)} days {when}."
            if task.date_sensitive:
                reason += f" Review the date with {task.external_party or 'the provider'}."
            if proposed < date.today():
                reason += " The new due date is already past."
            items.append(
                ImpactItem(
                    plugin=self.name,
                    kind="task",
                    ref_id=task.id,
                    title=task.title,
                    category=task.category,
                    action="reschedule",
                    reason=reason,
                    current_value=_fmt(task.due_date),
                    proposed_value=_fmt(proposed),
                    requires_external_confirmation=external,
                )
            )
        return items

    def apply_impact(self, db, life_event, items, delta_days):
        for item in items:
            task = db.get(Task, item.ref_id)
            if task is None or task.user_id != life_event.user_id:
                continue
            if item.action == "review":
                service.mark_status(db, task, "needs_review")
            elif item.proposed_value:
                task.due_date = date.fromisoformat(item.proposed_value)
                if item.requires_external_confirmation and task.status == "todo":
                    task.status = "needs_review"
            events.bus.publish(db, events.TASK_SAVED, {"task": task})

    def export_user_data(self, db, user_id):
        tasks = list(db.scalars(select(Task).where(Task.user_id == user_id)))
        return {"tasks": [t.model_dump(mode="json") for t in to_out(db, tasks)]}

    def delete_user_data(self, db, user_id):
        delete_rows(db, user_id, ImpactReview, Task)


plugin = TasksPlugin()
