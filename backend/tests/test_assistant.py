from settlewise.core import db
from settlewise.core.models import User
from settlewise.plugins.assistant import AskIn, ask

from .conftest import days, set_profile

API = "/api/v1"


def test_offline_answer_cites_sources_and_suggests_actions(client, auth):
    res = client.post(
        f"{API}/assistant/ask", json={"question": "How do I change my address with the CRA after moving?"}, headers=auth
    )
    assert res.status_code == 200, res.text
    answer = res.json()
    assert answer["model"] == "offline"
    assert "cra-my-account" in [s["id"] for s in answer["sources"]]
    assert all(s["review_status"] == "pending_review" for s in answer["sources"])
    assert not answer["needs_professional"]
    assert answer["suggested_actions"]
    plan = client.post(f"{API}/events", json={"event_type": "moving", "key_date": days(30)}, headers=auth).json()
    added = client.post(
        f"{API}/assistant/history/{answer['id']}/actions/0", json={"life_event_id": plan["id"]}, headers=auth
    ).json()
    task_id = added["suggested_actions"][0]["added_task_id"]
    assert client.get(f"{API}/tasks/{task_id}", headers=auth).json()["life_event_id"] == plan["id"]
    assert len(client.get(f"{API}/assistant/history", headers=auth).json()) == 1


def test_case_specific_question_is_referred(client, auth):
    answer = client.post(
        f"{API}/assistant/ask", json={"question": "Am I eligible for citizenship next year?"}, headers=auth
    ).json()
    assert answer["needs_professional"]
    assert "immigration_consultant" in answer["professional_service_types"]
    assert "cicc-find-consultant" in [s["id"] for s in answer["sources"]]


def test_unmatched_question_flags_uncertainty(client, auth):
    answer = client.post(f"{API}/assistant/ask", json={"question": "zzqx flurb wobble"}, headers=auth).json()
    assert answer["confidence"] == "low" and answer["uncertainty_note"]


class FakeClaude:
    """Stands in for ClaudeAnswerer to test how model output is checked."""

    def __init__(self):
        self.seen = None

    def answer(self, question, sources, context, history):
        self.seen = context
        return {
            "answer": "Update your address in CRA My Account.",
            "source_ids": ["cra-my-account", "made-up-source"],
            "confidence": "high",
            "uncertainty_note": "",
            "needs_professional": False,
            "professional_reason": "",
            "suggested_actions": [{"title": "Update address with CRA", "category": "government"}],
            "model": "claude-opus-5-5",
        }


def test_model_output_is_validated(client, auth):
    set_profile(client, auth, phone="416-555-0000")
    fake = FakeClaude()
    with db.SessionLocal() as s:
        user = s.query(User).filter_by(email="sarah@test.dev").one()
        q = ask(s, user, AskIn(question="How do I update my address with the CRA?"), answerer=fake)
        assert q.source_ids == ["cra-my-account"]  # unknown source dropped
        assert q.model == "claude-opus-5-5"
    assert "phone" not in fake.seen and fake.seen["province"] == "ON"  # no contact details sent to the model
