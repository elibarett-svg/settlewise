"""3.0 AI Settlement Assistant - plain-language answers backed by reviewed official sources."""

from datetime import date, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import JSON, Boolean, ForeignKey, String, Text, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from ...core import events
from ...core.config import get_settings
from ...core.db import Base, Entity, get_db
from ...core.deps import get_current_user, get_owned
from ...core.models import LifeEvent, User
from ...core.plugin import Plugin, registry
from ...core.util import delete_rows
from . import knowledge
from .llm import ClaudeAnswerer, llm_configured

PROFESSIONAL_SERVICE_TYPES = ["immigration_consultant", "legal_clinic"]


class Question(Entity, Base):
    __tablename__ = "assistant_questions"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    life_event_id: Mapped[str | None] = mapped_column(ForeignKey("life_events.id", ondelete="SET NULL"), nullable=True)
    question: Mapped[str] = mapped_column(Text)
    answer: Mapped[str] = mapped_column(Text)
    source_ids: Mapped[list] = mapped_column(JSON, default=list)
    confidence: Mapped[str] = mapped_column(String(10), default="low")
    uncertainty_note: Mapped[str] = mapped_column(Text, default="")
    needs_professional: Mapped[bool] = mapped_column(Boolean, default=False)
    professional_reason: Mapped[str] = mapped_column(Text, default="")
    suggested_actions: Mapped[list] = mapped_column(JSON, default=list)
    model: Mapped[str] = mapped_column(String(60), default="offline")


class AskIn(BaseModel):
    question: str = Field(min_length=3, max_length=2000)
    life_event_id: str | None = None


class SourceOut(BaseModel):
    id: str
    title: str
    publisher: str
    url: str
    reviewed_on: date | None
    review_status: str


class ActionOut(BaseModel):
    title: str
    category: str
    added_task_id: str | None = None


class AnswerOut(BaseModel):
    id: str
    question: str
    answer: str
    sources: list[SourceOut]
    confidence: str
    uncertainty_note: str
    needs_professional: bool
    professional_reason: str
    professional_service_types: list[str]
    suggested_actions: list[ActionOut]
    life_event_id: str | None
    model: str
    created_at: datetime


class AddActionIn(BaseModel):
    life_event_id: str | None = None
    due_date: date | None = None


def source_out(s: dict[str, Any]) -> SourceOut:
    return SourceOut(
        id=s["id"],
        title=s["title"],
        publisher=s.get("publisher", ""),
        url=s["url"],
        reviewed_on=s.get("reviewed_on"),
        review_status="reviewed" if s.get("reviewed_on") else "pending_review",
    )


def answer_out(q: Question) -> AnswerOut:
    sources = [source_out(s) for s in (knowledge.source_by_id(i) for i in q.source_ids) if s]
    return AnswerOut(
        id=q.id,
        question=q.question,
        answer=q.answer,
        sources=sources,
        confidence=q.confidence,
        uncertainty_note=q.uncertainty_note,
        needs_professional=q.needs_professional,
        professional_reason=q.professional_reason,
        professional_service_types=PROFESSIONAL_SERVICE_TYPES if q.needs_professional else [],
        suggested_actions=[ActionOut(**a) for a in q.suggested_actions or []],
        life_event_id=q.life_event_id,
        model=q.model,
        created_at=q.created_at,
    )


def person_context(db: Session, user: User, life_event_id: str | None) -> dict[str, Any]:
    """Only coarse, non-identifying facts are sent to the model - never names,
    contact details or document numbers."""
    ctx: dict[str, Any] = {"preferred_language": user.display_language}
    if registry.is_enabled("profile"):
        from ..profile import planning_context

        full = planning_context(db, user.id)
        ctx.update({k: full[k] for k in ("immigration_status", "province", "city", "household_size", "has_children")})
        if full.get("arrival_date"):
            ctx["arrived"] = full["arrival_date"][:7]
    active = db.scalars(select(LifeEvent).where(LifeEvent.user_id == user.id, LifeEvent.status == "active")).all()
    ctx["active_plans"] = [{"type": e.event_type, "key_date": e.key_date.isoformat()} for e in active]
    if life_event_id:
        ctx["question_is_about_plan"] = next((e.event_type for e in active if e.id == life_event_id), None)
    return ctx


def template_suggestions(source_ids: list[str], limit: int = 3) -> list[dict[str, str]]:
    """Offline 3.5: suggest plan steps from life-event templates that cite the same sources."""
    if not registry.is_enabled("planning"):
        return []
    from ..planning import load_templates

    out, seen = [], set()
    for tpl in load_templates().values():
        for task in tpl.get("tasks", []):
            if set(task.get("source_ids", [])) & set(source_ids) and task["title"] not in seen:
                seen.add(task["title"])
                out.append({"title": task["title"], "category": task.get("category", "general")})
    return out[:limit]


def offline_answer(question: str, hits: list[tuple[dict[str, Any], float]], pro_reason: str | None) -> dict[str, Any]:
    if not hits:
        return {
            "answer": (
                "I could not find a reviewed source that covers this question. Try rephrasing it, or "
                "contact a free settlement agency who can help in person."
            ),
            "source_ids": [],
            "confidence": "low",
            "uncertainty_note": "No reviewed source matched this question.",
            "needs_professional": bool(pro_reason),
            "professional_reason": pro_reason or "",
            "suggested_actions": [],
            "model": "offline",
        }
    top = hits[:2]
    lines = [f"• {s['title']}: {s['summary'].strip()}" for s, _ in top]
    best = top[0][1]
    return {
        "answer": "Here is what the official sources say:\n\n" + "\n\n".join(lines),
        "source_ids": [s["id"] for s, _ in top],
        "confidence": "medium" if best >= 4 else "low",
        "uncertainty_note": (
            "" if best >= 4 else "These sources may only partly answer your question. Check the linked pages."
        ),
        "needs_professional": bool(pro_reason),
        "professional_reason": pro_reason or "",
        "suggested_actions": template_suggestions([s["id"] for s, _ in top]),
        "model": "offline",
    }


def ask(db: Session, user: User, body: AskIn, answerer: ClaudeAnswerer | None = None) -> Question:
    if body.life_event_id:
        get_owned(db, LifeEvent, body.life_event_id, user.id, "Life event")
    pro_reason = knowledge.needs_professional(body.question)
    hits = knowledge.search(body.question)
    if pro_reason and not any(s["id"] == "cicc-find-consultant" for s, _ in hits):
        hits.append((knowledge.source_by_id("cicc-find-consultant"), 0.0))

    settings = get_settings()
    data = None
    if answerer is None and settings.assistant_use_llm and llm_configured():
        answerer = ClaudeAnswerer(settings.anthropic_model)
    if answerer is not None:
        history = [
            {"question": q.question, "answer": q.answer[:600]}
            for q in db.scalars(
                select(Question).where(Question.user_id == user.id).order_by(Question.created_at.desc()).limit(3)
            )
        ][::-1]
        data = answerer.answer(
            body.question, [s for s, _ in hits], person_context(db, user, body.life_event_id), history
        )
    if data is None:
        data = offline_answer(body.question, hits, pro_reason)

    allowed = {s["id"] for s, _ in hits}
    source_ids = [i for i in data.get("source_ids", []) if i in allowed]  # never cite unknown pages
    needs_pro = bool(data.get("needs_professional")) or bool(pro_reason)
    if needs_pro and "cicc-find-consultant" not in source_ids:
        source_ids.append("cicc-find-consultant")
    if not source_ids and data.get("confidence") == "high":
        data["confidence"] = "medium"
    q = Question(
        user_id=user.id,
        life_event_id=body.life_event_id,
        question=body.question,
        answer=data["answer"],
        source_ids=source_ids,
        confidence=data.get("confidence", "low"),
        uncertainty_note=data.get("uncertainty_note", ""),
        needs_professional=needs_pro,
        professional_reason=data.get("professional_reason") or pro_reason or "",
        suggested_actions=[
            {"title": a["title"], "category": a.get("category", "general")}
            for a in data.get("suggested_actions", [])[:3]
        ],
        model=data.get("model", "offline"),
    )
    db.add(q)
    db.flush()
    return q


def build_router() -> APIRouter:
    r = APIRouter(prefix="/assistant", tags=["3.0 AI Settlement Assistant"])

    @r.post("/ask", response_model=AnswerOut, summary="3.1 Ask Question (+3.2, 3.3, 3.4, 3.5)")
    def ask_route(body: AskIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        return answer_out(ask(db, user, body))

    @r.get("/history", response_model=list[AnswerOut], summary="3.6 View Question History")
    def history(
        life_event_id: str | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ):
        stmt = select(Question).where(Question.user_id == user.id)
        if life_event_id:
            stmt = stmt.where(Question.life_event_id == life_event_id)
        return [answer_out(q) for q in db.scalars(stmt.order_by(Question.created_at.desc()))]

    @r.delete("/history/{question_id}", status_code=204)
    def forget(question_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        db.delete(get_owned(db, Question, question_id, user.id, "Question"))

    @r.post(
        "/history/{question_id}/actions/{index}",
        response_model=AnswerOut,
        summary="3.5 Suggest Next Actions - add one to the plan",
    )
    def add_action(
        question_id: str,
        index: int,
        body: AddActionIn,
        user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ):
        if not registry.is_enabled("tasks"):
            raise HTTPException(404, "Tasks are not enabled")
        from ..tasks.models import Task

        q = get_owned(db, Question, question_id, user.id, "Question")
        actions = list(q.suggested_actions or [])
        if not 0 <= index < len(actions):
            raise HTTPException(404, "Suggestion not found")
        if actions[index].get("added_task_id"):
            return answer_out(q)
        event_id = body.life_event_id or q.life_event_id
        if event_id:
            get_owned(db, LifeEvent, event_id, user.id, "Life event")
        task = Task(
            user_id=user.id,
            life_event_id=event_id,
            title=actions[index]["title"],
            category=actions[index].get("category", "general"),
            due_date=body.due_date,
            source_ids=q.source_ids,
            guidance="Suggested by the SettleWise assistant.",
        )
        db.add(task)
        db.flush()
        events.bus.publish(db, events.TASK_SAVED, {"task": task})
        actions[index] = {**actions[index], "added_task_id": task.id}
        q.suggested_actions = actions
        return answer_out(q)

    @r.get("/sources", response_model=list[SourceOut], summary="3.2 reviewed sources")
    def sources(user: User = Depends(get_current_user)):
        return [source_out(s) for s in knowledge.load_sources()]

    @r.get("/status")
    def status(user: User = Depends(get_current_user)):
        settings = get_settings()
        live = settings.assistant_use_llm and llm_configured()
        return {"mode": "claude" if live else "offline", "model": settings.anthropic_model if live else None}

    return r


class AssistantPlugin(Plugin):
    name = "assistant"
    feature_id = "3.0"
    title = "AI Settlement Assistant"
    functions = {
        "3.1": "Ask Question",
        "3.2": "Show Source Links",
        "3.3": "Flag Uncertainty",
        "3.4": "Refer to Professional",
        "3.5": "Suggest Next Actions",
        "3.6": "View Question History",
    }

    def build_router(self):
        return build_router()

    def export_user_data(self, db, user_id):
        return {
            "questions": [
                answer_out(q).model_dump(mode="json")
                for q in db.scalars(select(Question).where(Question.user_id == user_id))
            ]
        }

    def delete_user_data(self, db, user_id):
        delete_rows(db, user_id, Question)


plugin = AssistantPlugin()
