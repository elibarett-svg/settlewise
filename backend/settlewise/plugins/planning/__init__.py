"""2.0 Life Event Planning Engine - turn a life event into an ordered, personalised plan."""

from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...core import events
from ...core.db import get_db, utcnow
from ...core.deps import get_current_user, get_owned
from ...core.models import LifeEvent, User
from ...core.plugin import Plugin
from ...core.util import delete_rows
from ..profile import planning_context
from ..tasks import TaskOut, to_out
from ..tasks import service as task_service

TEMPLATE_DIR = Path(__file__).parent / "templates"


@lru_cache
def load_templates() -> dict[str, dict[str, Any]]:
    templates = {}
    for path in sorted(TEMPLATE_DIR.glob("*.yaml")):
        data = yaml.safe_load(path.read_text())
        templates[data["id"]] = data
    return templates


def matches(condition: dict[str, Any] | None, ctx: dict[str, Any]) -> bool:
    """Evaluate a template ``when`` block: every key must match the profile context.
    A list means "any of these values"."""
    for key, expected in (condition or {}).items():
        actual = ctx.get(key)
        if isinstance(expected, list):
            if actual not in expected:
                return False
        elif actual != expected:
            return False
    return True


def select_tasks(template: dict[str, Any], ctx: dict[str, Any]) -> list[dict[str, Any]]:
    chosen = [t for t in template.get("tasks", []) if matches(t.get("when"), ctx)]
    keys = {t["key"] for t in chosen}
    # Drop dependencies on tasks that did not apply to this person.
    return [{**t, "depends_on": [d for d in t.get("depends_on", []) or [] if d in keys]} for t in chosen]


class TemplateOut(BaseModel):
    id: str
    title: str
    description: str
    key_date_label: str
    task_count: int


class EventIn(BaseModel):
    event_type: str
    key_date: date
    title: str | None = Field(default=None, max_length=200)
    notes: str = ""


class EventPatch(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    notes: str | None = None


class EventOut(BaseModel):
    id: str
    event_type: str
    title: str
    key_date: date
    key_date_label: str
    status: str
    notes: str
    progress: dict[str, Any]


class EventDetail(EventOut):
    tasks: list[TaskOut]


def event_out(db: Session, ev: LifeEvent) -> EventOut:
    tpl = load_templates().get(ev.event_type, {})
    return EventOut(
        id=ev.id,
        event_type=ev.event_type,
        title=ev.title,
        key_date=ev.key_date,
        key_date_label=tpl.get("key_date_label", "Key date"),
        status=ev.status,
        notes=ev.notes,
        progress=task_service.progress(db, ev.id),
    )


def event_detail(db: Session, ev: LifeEvent) -> EventDetail:
    return EventDetail(**event_out(db, ev).model_dump(), tasks=to_out(db, task_service.event_tasks(db, ev.id)))


def create_life_event(db: Session, user_id: str, body: EventIn) -> LifeEvent:
    template = load_templates().get(body.event_type)
    if template is None:
        raise HTTPException(422, f"Unknown life event. Choose one of: {', '.join(load_templates())}")
    ev = LifeEvent(
        user_id=user_id,
        event_type=body.event_type,
        title=body.title or template["title"],
        key_date=body.key_date,
        notes=body.notes,
    )
    db.add(ev)
    db.flush()
    ctx = planning_context(db, user_id)
    events.bus.publish(
        db,
        events.LIFE_EVENT_CREATED,
        {
            "life_event": ev,
            "template": template,
            "tasks": select_tasks(template, ctx),
            "costs": template.get("costs", []),
            "context": ctx,
        },
    )
    return ev


def build_router() -> APIRouter:
    r = APIRouter(prefix="/events", tags=["2.0 Life Event Planning"])

    @r.get("/templates", response_model=list[TemplateOut])
    def templates():
        return [
            TemplateOut(
                id=t["id"],
                title=t["title"],
                description=t.get("description", ""),
                key_date_label=t.get("key_date_label", "Key date"),
                task_count=len(t.get("tasks", [])),
            )
            for t in load_templates().values()
        ]

    @r.get("", response_model=list[EventOut])
    def list_events(status: str | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        stmt = select(LifeEvent).where(LifeEvent.user_id == user.id)
        if status:
            stmt = stmt.where(LifeEvent.status == status)
        return [event_out(db, ev) for ev in db.scalars(stmt.order_by(LifeEvent.key_date))]

    @r.post("", response_model=EventDetail, status_code=201, summary="2.1 Select Life Event + 2.2 Generate Action Plan")
    def create(body: EventIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        return event_detail(db, create_life_event(db, user.id, body))

    @r.get("/{event_id}", response_model=EventDetail)
    def read(event_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        return event_detail(db, get_owned(db, LifeEvent, event_id, user.id, "Life event"))

    @r.patch(
        "/{event_id}", response_model=EventOut, summary="Edit title/notes (change the key date via /impact/preview)"
    )
    def update(event_id: str, body: EventPatch, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        ev = get_owned(db, LifeEvent, event_id, user.id, "Life event")
        for k, v in body.model_dump(exclude_unset=True).items():
            setattr(ev, k, v)
        return event_out(db, ev)

    @r.get("/{event_id}/progress", summary="2.4 View Plan Progress")
    def progress(event_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        get_owned(db, LifeEvent, event_id, user.id, "Life event")
        return task_service.progress(db, event_id)

    @r.post("/{event_id}/close", response_model=EventOut, summary="2.5 Close Life Event")
    def close(event_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        ev = get_owned(db, LifeEvent, event_id, user.id, "Life event")
        ev.status, ev.closed_at = "closed", utcnow()
        events.bus.publish(db, events.LIFE_EVENT_CLOSED, {"life_event": ev})
        return event_out(db, ev)

    @r.post("/{event_id}/reopen", response_model=EventOut)
    def reopen(event_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        ev = get_owned(db, LifeEvent, event_id, user.id, "Life event")
        ev.status, ev.closed_at = "active", None
        return event_out(db, ev)

    @r.delete("/{event_id}", status_code=204)
    def delete(event_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        ev = get_owned(db, LifeEvent, event_id, user.id, "Life event")
        events.bus.publish(db, events.LIFE_EVENT_DELETED, {"life_event": ev})
        for task in task_service.event_tasks(db, ev.id):
            events.bus.publish(db, events.TASK_DELETED, {"task": task})
        db.delete(ev)

    return r


class PlanningPlugin(Plugin):
    name = "planning"
    feature_id = "2.0"
    title = "Life Event Planning Engine"
    requires = ("profile", "tasks")
    functions = {
        "2.1": "Select Life Event",
        "2.2": "Generate Action Plan",
        "2.3": "Customize Plan",
        "2.4": "View Plan Progress",
        "2.5": "Close Life Event",
    }

    def build_router(self):
        return build_router()

    def export_user_data(self, db, user_id):
        rows = db.scalars(select(LifeEvent).where(LifeEvent.user_id == user_id))
        return {"life_events": [event_out(db, ev).model_dump(mode="json") for ev in rows]}

    def delete_user_data(self, db, user_id):
        delete_rows(db, user_id, LifeEvent)


plugin = PlanningPlugin()
