# Writing a SettleWise plugin

A plugin is a Python object that subclasses `settlewise.core.plugin.Plugin`. Built-in plugins live
in `backend/settlewise/plugins/`; a separate package can add one through the
`settlewise.plugins` entry-point group without changing this repository.

```python
# my_package/school_registration.py
from fastapi import APIRouter, Depends
from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, Session, mapped_column

from settlewise.core import events
from settlewise.core.db import Base, Entity, get_db
from settlewise.core.deps import get_current_user
from settlewise.core.plugin import ImpactItem, Plugin
from settlewise.core.util import delete_rows


class SchoolApplication(Entity, Base):
    __tablename__ = "school_applications"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    school: Mapped[str] = mapped_column(String(200))


class SchoolPlugin(Plugin):
    name = "schools"
    feature_id = "11.0"
    title = "School Registration"
    phase = "Growth"
    requires = ("profile",)
    functions = {"11.1": "Track School Applications"}

    def build_router(self):
        r = APIRouter(prefix="/schools", tags=["11.0 Schools"])

        @r.get("", summary="11.1 Track School Applications")
        def list_(user=Depends(get_current_user), db: Session = Depends(get_db)):
            ...

        return r

    def setup(self, ctx):
        ctx.bus.subscribe(events.LIFE_EVENT_CREATED, lambda db, payload: ...)

    def propose_impact(self, db, life_event, old_date, new_date) -> list[ImpactItem]:
        return []

    def delete_user_data(self, db, user_id):
        delete_rows(db, user_id, SchoolApplication)


plugin = SchoolPlugin()
```

Register it in the package's `pyproject.toml`:

```toml
[project.entry-points."settlewise.plugins"]
schools = "my_package.school_registration:plugin"
```

## Checklist

- Put the function ID in each route's `summary` (e.g. `"11.1 ..."`) so
  `scripts/traceability.py` can trace it.
- Scope every query by `user_id`; use `core.deps.get_owned` to fetch a row the user must own.
- Implement `export_user_data` and `delete_user_data` for every table that holds personal data.
- If your records hang off a life event and depend on its date, implement `propose_impact` and
  `apply_impact`.
- Never read another user's data directly - go through `consent.service.require_fields` /
  `shared_view` so it is consented and audited.
- Add tests under `backend/tests/`.

## Adding a life-event template

Templates are YAML files in `plugins/planning/templates/`. Each task has a `key`, `title`,
`category`, `offset_days` from the key date, and optional `depends_on`, `date_sensitive`,
`external_party`, `guidance`, `source_ids` (from the assistant's `sources.yaml`) and a `when`
condition on the profile (`immigration_status`, `province`, `has_children`, `has_vehicle`, ...).
Quote province codes (`["ON"]`): unquoted `ON` is read by YAML as `true`.
