"""The Project Vision scenario: Sarah moves her move date later; SettleWise lists
the linked tasks to review and changes only what she approves."""

from datetime import date, timedelta

from .conftest import set_profile

API = "/api/v1"


def setup_move(client, auth, key: date):
    set_profile(client, auth)
    plan = client.post(f"{API}/events", json={"event_type": "moving", "key_date": key.isoformat()}, headers=auth).json()
    providers = client.get(
        f"{API}/providers", params={"service_type": "settlement_agency", "city": "Toronto"}, headers=auth
    ).json()
    client.post(
        f"{API}/referrals",
        json={"provider_id": providers[0]["id"], "reason": "Find a family doctor", "life_event_id": plan["id"]},
        headers=auth,
    )
    return plan


def test_change_date_lists_linked_items_for_review(client, auth):
    old = date.today() + timedelta(days=60)
    new = old + timedelta(days=17)
    plan = setup_move(client, auth, old)
    res = client.post(
        f"{API}/impact/preview", json={"life_event_id": plan["id"], "new_key_date": new.isoformat()}, headers=auth
    )
    assert res.status_code == 201, res.text
    review = res.json()
    assert review["delta_days"] == 17
    categories = set(review["summary"])
    assert {"utilities", "insurance", "travel", "budget", "referral"} <= categories
    utilities = next(i for i in review["items"] if i["category"] == "utilities")
    assert utilities["requires_external_confirmation"]
    assert utilities["proposed_value"] == (new - timedelta(days=14)).isoformat()
    # Nothing changes until the user approves
    event = client.get(f"{API}/events/{plan['id']}", headers=auth).json()
    assert event["key_date"] == old.isoformat()


def test_apply_only_approved_items(client, auth):
    old = date.today() + timedelta(days=60)
    new = old + timedelta(days=17)
    plan = setup_move(client, auth, old)
    review = client.post(
        f"{API}/impact/preview", json={"life_event_id": plan["id"], "new_key_date": new.isoformat()}, headers=auth
    ).json()
    utilities = next(i for i in review["items"] if i["category"] == "utilities")
    movers = next(i for i in review["items"] if i["category"] == "travel")
    costs = [i for i in review["items"] if i["category"] == "budget"]
    approved = [utilities["id"]] + [c["id"] for c in costs]
    res = client.post(f"{API}/impact/{review['id']}/apply", json={"approved_item_ids": approved}, headers=auth)
    assert res.status_code == 200 and res.json()["status"] == "applied"

    event = client.get(f"{API}/events/{plan['id']}", headers=auth).json()
    assert event["key_date"] == new.isoformat()
    tasks = {t["id"]: t for t in event["tasks"]}
    assert tasks[utilities["ref_id"]]["due_date"] == utilities["proposed_value"]
    assert tasks[utilities["ref_id"]]["status"] == "needs_review"  # provider must still confirm
    assert tasks[movers["ref_id"]]["due_date"] == movers["current_value"]  # not approved, unchanged
    event_costs = client.get(f"{API}/finance/event-costs", params={"life_event_id": plan["id"]}, headers=auth).json()
    assert {c["due_date"] for c in event_costs} == {c["proposed_value"] for c in costs}
    assert (
        client.post(f"{API}/impact/{review['id']}/apply", json={"approved_item_ids": []}, headers=auth).status_code
        == 409
    )


def test_completed_external_task_is_flagged_for_review(client, auth):
    old = date.today() + timedelta(days=60)
    plan = setup_move(client, auth, old)
    movers = next(t for t in plan["tasks"] if "movers" in t["title"].lower())
    client.patch(f"{API}/tasks/{movers['id']}", json={"status": "done"}, headers=auth)
    review = client.post(
        f"{API}/impact/preview",
        json={"life_event_id": plan["id"], "new_key_date": (old + timedelta(days=5)).isoformat()},
        headers=auth,
    ).json()
    item = next(i for i in review["items"] if i["ref_id"] == movers["id"])
    assert item["action"] == "review" and item["requires_external_confirmation"]
    client.post(f"{API}/impact/{review['id']}/apply", json={"approved_item_ids": [item["id"]]}, headers=auth)
    assert client.get(f"{API}/tasks/{movers['id']}", headers=auth).json()["status"] == "needs_review"


def test_new_preview_supersedes_pending_one(client, auth):
    old = date.today() + timedelta(days=60)
    plan = setup_move(client, auth, old)
    first = client.post(
        f"{API}/impact/preview",
        json={"life_event_id": plan["id"], "new_key_date": (old + timedelta(days=3)).isoformat()},
        headers=auth,
    ).json()
    client.post(
        f"{API}/impact/preview",
        json={"life_event_id": plan["id"], "new_key_date": (old + timedelta(days=4)).isoformat()},
        headers=auth,
    )
    assert client.get(f"{API}/impact/{first['id']}", headers=auth).json()["status"] == "superseded"
