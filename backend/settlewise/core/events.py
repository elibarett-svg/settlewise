"""In-process event bus. Plugins publish domain events and react to each other's
events without importing each other - e.g. a document being saved schedules an
expiry reminder in the notifications plugin."""

import logging
from collections import defaultdict
from collections.abc import Callable
from typing import Any

from sqlalchemy.orm import Session

log = logging.getLogger("settlewise.events")

Handler = Callable[[Session, dict[str, Any]], Any]

# Event names used across plugins - kept in one place so they are discoverable.
LIFE_EVENT_CREATED = "life_event.created"
LIFE_EVENT_DATE_CHANGED = "life_event.date_changed"
LIFE_EVENT_CLOSED = "life_event.closed"
LIFE_EVENT_DELETED = "life_event.deleted"
TASK_SAVED = "task.saved"
TASK_DELETED = "task.deleted"
DOCUMENT_SAVED = "document.saved"
DOCUMENT_DELETED = "document.deleted"
BILL_SAVED = "bill.saved"
BILL_DELETED = "bill.deleted"
REFERRAL_SAVED = "referral.saved"
PROFILE_UPDATED = "profile.updated"


class EventBus:
    def __init__(self) -> None:
        self._handlers: dict[str, list[Handler]] = defaultdict(list)

    def subscribe(self, name: str, handler: Handler) -> None:
        self._handlers[name].append(handler)

    def publish(self, db: Session, name: str, payload: dict[str, Any]) -> list[Any]:
        """Run handlers synchronously inside the caller's transaction, so a failed
        handler rolls back the whole request instead of leaving data half-updated."""
        results = []
        for handler in self._handlers.get(name, []):
            log.debug("event %s -> %s", name, getattr(handler, "__qualname__", handler))
            results.append(handler(db, payload))
        return results

    def clear(self) -> None:
        self._handlers.clear()


bus = EventBus()
