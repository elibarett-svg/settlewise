from fastapi.testclient import TestClient

from settlewise.core import db
from settlewise.core.config import Settings
from settlewise.main import create_app


def test_meta_lists_enabled_plugins(client):
    meta = client.get("/api/v1/meta").json()
    names = {p["name"] for p in meta["plugins"]}
    assert {
        "account",
        "profile",
        "planning",
        "assistant",
        "tasks",
        "finance",
        "referrals",
        "consent",
        "notifications",
        "worker_portal",
        "autofill",
    } <= names
    functions = {f for p in meta["plugins"] for f in p["functions"]}
    assert len(functions) == 53  # every function in the product decomposition


def test_phase_gating_hides_enterprise_features():
    app = create_app(Settings(database_url="sqlite://", enabled_phases=["MVP"], run_background_dispatcher=False))
    db.Base.metadata.drop_all(db.engine)
    with TestClient(app) as c:
        meta = c.get("/api/v1/meta").json()
        assert "worker_portal" in meta["skipped"] and "autofill" in meta["skipped"]
        assert c.get("/api/v1/worker/clients").status_code == 404


def test_disabled_plugin_and_dependents_are_skipped():
    app = create_app(
        Settings(
            database_url="sqlite://",
            disabled_plugins=["tasks"],
            run_background_dispatcher=False,
            enabled_phases=["MVP"],
        )
    )
    db.Base.metadata.drop_all(db.engine)
    with TestClient(app) as c:
        skipped = c.get("/api/v1/meta").json()["skipped"]
        assert skipped["tasks"] == "disabled in settings"
        assert skipped["planning"].startswith("requires")
