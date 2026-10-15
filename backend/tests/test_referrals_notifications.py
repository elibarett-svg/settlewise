from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from settlewise.core import db
from settlewise.core.config import get_settings
from settlewise.plugins.notifications.models import Reminder
from settlewise.plugins.notifications.service import dispatch_due

from .conftest import days

API = "/api/v1"


def test_directory_and_referral_lifecycle(client, auth):
    clinics = client.get(f"{API}/providers", params={"service_type": "legal_clinic"}, headers=auth).json()
    assert clinics and all(p["is_sample"] for p in clinics)
    ref = client.post(
        f"{API}/referrals",
        json={"provider_id": clinics[0]["id"], "reason": "Lease question", "info_needed": ["Lease copy"]},
        headers=auth,
    ).json()
    assert ref["status"] == "requested" and ref["next_owner"] == "provider"
    assert ref["recipient_name"] == clinics[0]["name"]
    assert (
        client.post(f"{API}/referrals/{ref['id']}/status", json={"status": "completed"}, headers=auth).status_code
        == 409
    )
    ref = client.post(f"{API}/referrals/{ref['id']}/status", json={"status": "accepted"}, headers=auth).json()
    assert ref["next_owner"] == "me"
    ref = client.post(
        f"{API}/referrals/{ref['id']}/status", json={"status": "scheduled", "scheduled_for": days(3)}, headers=auth
    ).json()
    assert ref["follow_up_date"] == days(4)
    ref = client.patch(f"{API}/referrals/{ref['id']}", json={"next_owner": "provider"}, headers=auth).json()
    assert ref["next_owner"] == "provider"
    ref = client.post(
        f"{API}/referrals/{ref['id']}/status", json={"status": "completed", "outcome": "Resolved"}, headers=auth
    ).json()
    assert [h["status"] for h in ref["history"]] == ["requested", "accepted", "scheduled", "completed"]
    assert client.get(f"{API}/referrals", params={"open_only": True}, headers=auth).json() == []


def test_reminders_created_from_tasks_bills_documents(client, auth):
    client.post(f"{API}/tasks", json={"title": "Call landlord", "due_date": days(5)}, headers=auth)
    client.post(f"{API}/finance/bills", json={"name": "Hydro", "amount": 80, "next_due_date": days(10)}, headers=auth)
    client.post(
        f"{API}/profile/documents",
        json={"doc_type": "pr_card", "number": "PR 1234-5678", "expires_on": days(100)},
        headers=auth,
    )
    docs = client.get(f"{API}/profile/documents", headers=auth).json()
    assert docs[0]["number_masked"] == "•••• 5678"  # full number never stored
    kinds = sorted(r["kind"] for r in client.get(f"{API}/notifications/reminders", headers=auth).json())
    assert kinds == ["bill", "document", "document", "document", "task"]  # 90/30/7 days before expiry


def test_dispatch_inbox_snooze_and_quiet_hours(client, auth):
    client.put(
        f"{API}/notifications/preferences",
        json={"timezone": "UTC", "quiet_start": "22:00", "quiet_end": "07:00"},
        headers=auth,
    )
    rem = client.post(
        f"{API}/notifications/reminders",
        json={"title": "Book movers", "remind_at": (datetime.now(UTC) - timedelta(minutes=1)).isoformat()},
        headers=auth,
    )
    assert rem.status_code == 201
    settings = get_settings()
    noon = datetime.now(UTC).replace(hour=12, minute=0)
    late = datetime.now(UTC).replace(hour=23, minute=0)
    with db.SessionLocal() as s:
        assert dispatch_due(s, settings, now=late) == 0  # quiet hours: deferred
        deferred = s.scalar(select(Reminder).where(Reminder.title == "Book movers"))
        assert deferred.remind_at.hour == 7
        assert dispatch_due(s, settings, now=noon + timedelta(days=1)) == 1
        s.commit()
    inbox = client.get(f"{API}/notifications", headers=auth).json()
    assert inbox[0]["title"] == "Book movers"
    assert client.get(f"{API}/notifications/unread-count", headers=auth).json()["unread"] == 1
    snoozed = client.post(
        f"{API}/notifications/{inbox[0]['id']}/action", json={"action": "snooze", "snooze_minutes": 60}, headers=auth
    ).json()
    assert snoozed["status"] == "snoozed"
    assert client.get(f"{API}/notifications", headers=auth).json() == []


def test_completing_task_cancels_reminder(client, auth):
    task = client.post(f"{API}/tasks", json={"title": "Sign lease", "due_date": days(5)}, headers=auth).json()
    client.patch(f"{API}/tasks/{task['id']}", json={"status": "done"}, headers=auth)
    assert client.get(f"{API}/notifications/reminders", headers=auth).json() == []
