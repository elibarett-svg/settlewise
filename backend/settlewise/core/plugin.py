"""Plugin contract and registry.

Every SettleWise feature (1.0 - 10.0 in the product decomposition) is a plugin.
A plugin owns its tables, its API router and its event handlers, and can take part
in cross-cutting flows through optional hooks:

* ``propose_impact`` / ``apply_impact`` - event impact analysis (4.4)
* ``export_user_data`` / ``delete_user_data`` - data portability and erasure (10.4, 10.5)
* ``seed`` - reference data such as the provider directory (6.1)

Plugins are discovered from the ``settlewise.plugins`` entry-point group, so a
separate Python package can add a feature without touching this repository.
"""

from __future__ import annotations

import importlib
import logging
from dataclasses import dataclass, field
from datetime import date
from importlib.metadata import entry_points
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .config import Settings
from .db import new_id
from .events import EventBus

log = logging.getLogger("settlewise.plugins")

ENTRY_POINT_GROUP = "settlewise.plugins"

# Used when the package is run from source without being installed.
BUILTIN_PLUGINS = [
    "settlewise.plugins.account",
    "settlewise.plugins.profile",
    "settlewise.plugins.autofill",
    "settlewise.plugins.planning",
    "settlewise.plugins.tasks",
    "settlewise.plugins.assistant",
    "settlewise.plugins.finance",
    "settlewise.plugins.referrals",
    "settlewise.plugins.consent",
    "settlewise.plugins.worker_portal",
    "settlewise.plugins.notifications",
]


class ImpactItem(BaseModel):
    """One thing that needs review because a life event's key date changed."""

    id: str = Field(default_factory=new_id)
    plugin: str
    kind: str  # task | cost | referral | reminder ...
    ref_id: str
    title: str
    category: str = "general"
    reason: str
    current_value: str | None = None
    proposed_value: str | None = None
    action: Literal["reschedule", "review", "recalculate", "info"] = "reschedule"
    # True when someone outside SettleWise (landlord, utility, insurer...) must
    # confirm. SettleWise only changes the user's own plan; provider records stay
    # pending until the user records a response.
    requires_external_confirmation: bool = False
    data: dict[str, Any] = Field(default_factory=dict)


@dataclass
class PluginContext:
    settings: Settings
    bus: EventBus
    registry: PluginRegistry


class Plugin:
    name: str = ""
    feature_id: str = ""
    title: str = ""
    phase: str = "MVP"
    #: function id -> short description, published at /api/v1/meta for traceability
    functions: dict[str, str] = {}
    requires: tuple[str, ...] = ()

    def build_router(self) -> APIRouter | None:
        return None

    def setup(self, ctx: PluginContext) -> None:
        """Subscribe to events. Called once after every plugin is loaded."""

    async def run_background(self, ctx: PluginContext) -> None:
        """Optional long-running task started with the app (e.g. reminder dispatch)."""

    def seed(self, db: Session, ctx: PluginContext) -> None:
        """Load reference data at startup."""

    def export_user_data(self, db: Session, user_id: str) -> dict[str, Any] | None:
        return None

    def delete_user_data(self, db: Session, user_id: str) -> None:
        """Remove every row this plugin keeps for the user."""

    def propose_impact(self, db: Session, life_event: Any, old_date: date, new_date: date) -> list[ImpactItem]:
        return []

    def apply_impact(self, db: Session, life_event: Any, items: list[ImpactItem], delta_days: int) -> None:
        """Apply the approved items that belong to this plugin."""

    def manifest(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "feature_id": self.feature_id,
            "title": self.title,
            "phase": self.phase,
            "functions": self.functions,
        }


@dataclass
class PluginRegistry:
    plugins: dict[str, Plugin] = field(default_factory=dict)
    skipped: dict[str, str] = field(default_factory=dict)

    def all(self) -> list[Plugin]:
        return list(self.plugins.values())

    def get(self, name: str) -> Plugin | None:
        return self.plugins.get(name)

    def is_enabled(self, name: str) -> bool:
        return name in self.plugins

    def _candidates(self) -> list[Plugin]:
        found: list[Plugin] = []
        eps = entry_points(group=ENTRY_POINT_GROUP)
        if eps:
            for ep in eps:
                try:
                    found.append(ep.load())
                except Exception:  # pragma: no cover - broken third-party plugin
                    log.exception("Could not load plugin %s", ep.name)
        else:
            for module in BUILTIN_PLUGINS:
                found.append(importlib.import_module(module).plugin)
        return found

    def load(self, settings: Settings) -> None:
        self.plugins.clear()
        self.skipped.clear()
        candidates = {p.name: p for p in self._candidates()}
        for name, plugin in candidates.items():
            if name in settings.disabled_plugins:
                self.skipped[name] = "disabled in settings"
            elif plugin.phase not in settings.enabled_phases:
                self.skipped[name] = f"{plugin.phase} phase not enabled"
            else:
                self.plugins[name] = plugin
        # Drop plugins whose dependencies are missing (repeat until stable).
        changed = True
        while changed:
            changed = False
            for name, plugin in list(self.plugins.items()):
                missing = [r for r in plugin.requires if r not in self.plugins]
                if missing:
                    self.skipped[name] = f"requires {', '.join(missing)}"
                    del self.plugins[name]
                    changed = True
        for name, reason in self.skipped.items():
            log.info("Plugin %s not loaded: %s", name, reason)


registry = PluginRegistry()
