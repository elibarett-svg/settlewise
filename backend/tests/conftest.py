import os

# Configure before the app modules read settings.
os.environ["SETTLEWISE_ENV"] = "test"
os.environ["SETTLEWISE_DATABASE_URL"] = "sqlite://"
os.environ["SETTLEWISE_RUN_BACKGROUND_DISPATCHER"] = "false"
os.environ["SETTLEWISE_ENABLED_PHASES"] = '["MVP", "Growth", "Enterprise"]'
os.environ["SETTLEWISE_EXPO_PUSH_URL"] = ""
for var in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_PROFILE"):
    os.environ.pop(var, None)  # tests always use the offline assistant

from datetime import date, timedelta  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from settlewise.core import db  # noqa: E402
from settlewise.main import create_app  # noqa: E402


@pytest.fixture
def client():
    app = create_app()
    db.Base.metadata.drop_all(db.engine)
    with TestClient(app) as c:
        yield c


def register(
    client: TestClient, email: str = "sarah@test.dev", password: str = "correct-horse-1", name: str = "Sarah"
) -> dict:
    res = client.post("/api/v1/auth/register", json={"email": email, "password": password, "full_name": name})
    assert res.status_code == 201, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


@pytest.fixture
def auth(client):
    return register(client)


def days(n: int) -> str:
    return (date.today() + timedelta(days=n)).isoformat()


def set_profile(client, auth, **overrides):
    body = {"immigration_status": "permanent_resident", "province": "ON", "city": "Toronto", **overrides}
    res = client.put("/api/v1/profile", json=body, headers=auth)
    assert res.status_code == 200, res.text
    return res.json()


def make_worker(client) -> dict:
    """Workers are provisioned by an administrator; tests promote a registered user directly."""
    from sqlalchemy import select

    from settlewise.core.models import User

    headers = register(client, "worker@test.dev", name="Amara Worker")
    with db.SessionLocal() as s:
        user = s.scalar(select(User).where(User.email == "worker@test.dev"))
        user.role = "worker"
        s.commit()
    return headers
