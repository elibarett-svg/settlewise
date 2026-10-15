from .conftest import days, make_worker, register, set_profile

API = "/api/v1"


def test_grant_revoke_and_audit(client, auth):
    res = client.post(
        f"{API}/consent/grants",
        json={
            "recipient_type": "advisor",
            "recipient_name": "Community Legal Clinic",
            "fields": ["profile.address"],
            "purpose": "Tenant rights consultation",
            "duration_days": 14,
        },
        headers=auth,
    )
    assert res.status_code == 201, res.text
    grant = res.json()
    assert grant["status"] == "active" and grant["fields"] == ["profile.address"]
    bad = client.post(
        f"{API}/consent/grants",
        json={"recipient_type": "advisor", "recipient_name": "X", "fields": ["passwords"], "purpose": "nope"},
        headers=auth,
    )
    assert bad.status_code == 422
    assert client.post(f"{API}/consent/grants/{grant['id']}/revoke", headers=auth).json()["status"] == "revoked"
    actions = [e["action"] for e in client.get(f"{API}/consent/audit", headers=auth).json()]
    assert actions == ["grant_revoked", "grant_created"]


def test_worker_sees_only_consented_fields(client, auth):
    set_profile(client, auth, phone="416-555-0000")
    client.post(f"{API}/events", json={"event_type": "moving", "key_date": days(40)}, headers=auth)
    worker = make_worker(client)
    me = client.get(f"{API}/account/me", headers=auth).json()

    assert client.get(f"{API}/worker/clients/{me['id']}", headers=worker).status_code == 403
    assert client.get(f"{API}/worker/clients", headers=auth).status_code == 403  # newcomers are not workers

    client.post(
        f"{API}/worker/access-requests",
        json={
            "client_email": "sarah@test.dev",
            "fields": ["plans", "tasks", "profile.contact"],
            "purpose": "Settlement support",
        },
        headers=worker,
    )
    req = client.get(f"{API}/consent/requests", headers=auth).json()[0]
    bad = client.post(f"{API}/consent/requests/{req['id']}/approve", json={"fields": ["finance.summary"]}, headers=auth)
    assert bad.status_code == 422
    grant = client.post(
        f"{API}/consent/requests/{req['id']}/approve", json={"fields": ["plans", "tasks"]}, headers=auth
    ).json()
    assert grant["fields"] == ["plans", "tasks"]

    clients = client.get(f"{API}/worker/clients", headers=worker).json()
    assert clients[0]["open_tasks"] > 0 and clients[0]["open_referrals"] is None
    view = client.get(f"{API}/worker/clients/{me['id']}", headers=worker).json()
    assert set(view) == {"plans", "tasks"}  # no contact details - not approved
    note = client.post(
        f"{API}/worker/clients/{me['id']}/notes",
        json={"note": "Called about the move", "next_step": "Check lease"},
        headers=worker,
    )
    assert note.status_code == 201
    assert (
        client.post(
            f"{API}/worker/clients/{me['id']}/referrals",
            json={"recipient_name": "Clinic", "reason": "x"},
            headers=worker,
        ).status_code
        == 403
    )  # referrals not shared

    audit = client.get(f"{API}/consent/audit", headers=auth).json()
    viewed = [e for e in audit if e["action"] == "viewed"]
    assert viewed and viewed[0]["actor_label"] == "Amara Worker"

    client.post(f"{API}/consent/grants/{grant['id']}/revoke", headers=auth)
    assert client.get(f"{API}/worker/clients/{me['id']}", headers=worker).status_code == 403


def test_household_member_can_view_shared_grant(client, auth):
    partner = register(client, "partner@test.dev", name="Partner")
    set_profile(client, auth, address_line="1 Main St")
    grant = client.post(
        f"{API}/consent/grants",
        json={
            "recipient_type": "household",
            "recipient_name": "Partner",
            "recipient_email": "partner@test.dev",
            "fields": ["profile.address"],
            "purpose": "Shared household planning",
        },
        headers=auth,
    ).json()
    assert grant["recipient_has_account"]
    shared = client.get(f"{API}/consent/shared-with-me", headers=partner).json()
    data = client.get(f"{API}/consent/shared-with-me/{shared[0]['id']}", headers=partner).json()
    assert data == {"address": {"address_line": "1 Main St", "city": "Toronto", "province": "ON", "postal_code": ""}}


def test_autofill_returns_only_shared_fields(client, auth):
    set_profile(client, auth, postal_code="M5V 0A0")
    grant = client.post(
        f"{API}/consent/grants",
        json={
            "recipient_type": "provider",
            "recipient_name": "Sample Insurer",
            "fields": ["profile.address"],
            "purpose": "Tenant insurance quote",
        },
        headers=auth,
    ).json()
    res = client.post(
        f"{API}/autofill/preview", json={"grant_id": grant["id"], "form_fields": ["postal_code", "phone"]}, headers=auth
    ).json()
    assert res["values"] == {"postal_code": "M5V 0A0"} and res["withheld"] == ["phone"]
