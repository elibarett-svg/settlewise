from datetime import date, timedelta

from .conftest import days, set_profile

API = "/api/v1"


def by_title(tasks, fragment):
    return next(t for t in tasks if fragment.lower() in t["title"].lower())


def test_plan_is_personalised_from_profile(client, auth):
    set_profile(client, auth, has_vehicle=False)
    client.post(f"{API}/profile/household", json={"full_name": "Leo", "relationship": "child"}, headers=auth)
    key = date.today() + timedelta(days=60)
    res = client.post(f"{API}/events", json={"event_type": "moving", "key_date": key.isoformat()}, headers=auth)
    assert res.status_code == 201, res.text
    plan = res.json()
    titles = [t["title"] for t in plan["tasks"]]
    assert any("school" in t for t in titles)  # has_children
    assert any("health card" in t for t in titles)  # province ON
    assert not any("vehicle" in t for t in titles)  # no vehicle
    notice = by_title(plan["tasks"], "notice")
    assert notice["due_date"] == (key - timedelta(days=60)).isoformat()
    assert plan["key_date_label"] == "Move date"
    # ordered by date
    dates = [t["due_date"] for t in plan["tasks"]]
    assert dates == sorted(dates)


def test_dependencies_block_and_unblock(client, auth):
    set_profile(client, auth)
    plan = client.post(f"{API}/events", json={"event_type": "moving", "key_date": days(60)}, headers=auth).json()
    lease = by_title(plan["tasks"], "lease")
    insurance = by_title(plan["tasks"], "tenant insurance")
    assert insurance["blocked_by"] == [lease["id"]]
    res = client.patch(f"{API}/tasks/{insurance['id']}", json={"status": "done"}, headers=auth)
    assert res.status_code == 409
    client.patch(f"{API}/tasks/{lease['id']}", json={"status": "done"}, headers=auth)
    res = client.patch(f"{API}/tasks/{insurance['id']}", json={"status": "done"}, headers=auth)
    assert res.status_code == 200 and res.json()["blocked_by"] == []
    # a dependency loop is refused
    res = client.post(f"{API}/tasks/{lease['id']}/dependencies", json={"depends_on_id": insurance["id"]}, headers=auth)
    assert res.status_code == 409


def test_customise_progress_and_close(client, auth):
    plan = client.post(f"{API}/events", json={"event_type": "travel", "key_date": days(90)}, headers=auth).json()
    ev = plan["id"]
    new = client.post(f"{API}/tasks", json={"title": "Buy a travel adapter", "life_event_id": ev}, headers=auth).json()
    assert new["position"] == len(plan["tasks"])
    order = [new["id"]] + [t["id"] for t in plan["tasks"]]
    reordered = client.post(f"{API}/tasks/reorder", json={"life_event_id": ev, "task_ids": order}, headers=auth).json()
    assert reordered[0]["id"] == new["id"]
    client.delete(f"{API}/tasks/{plan['tasks'][0]['id']}", headers=auth)
    client.patch(f"{API}/tasks/{new['id']}", json={"status": "done"}, headers=auth)
    progress = client.get(f"{API}/events/{ev}/progress", headers=auth).json()
    assert progress["completed"] == 1
    assert progress["total"] == len(plan["tasks"])  # +1 added, -1 removed
    assert "not an eligibility" in progress["score_note"]
    closed = client.post(f"{API}/events/{ev}/close", headers=auth).json()
    assert closed["status"] == "closed"
    assert (
        client.post(
            f"{API}/impact/preview", json={"life_event_id": ev, "new_key_date": days(100)}, headers=auth
        ).status_code
        == 409
    )


def test_task_filters(client, auth):
    plan = client.post(f"{API}/events", json={"event_type": "new_job", "key_date": days(30)}, headers=auth).json()
    client.post(f"{API}/tasks", json={"title": "Old thing", "due_date": days(-3)}, headers=auth)
    overdue = client.get(f"{API}/tasks", params={"status": "overdue"}, headers=auth).json()
    assert [t["title"] for t in overdue] == ["Old thing"]
    blocked = client.get(f"{API}/tasks", params={"status": "blocked"}, headers=auth).json()
    assert any("TD1" in t["title"] for t in blocked)
    scoped = client.get(f"{API}/tasks", params={"life_event_id": plan["id"], "category": "tax"}, headers=auth).json()
    assert len(scoped) == 1


def test_other_users_cannot_see_my_plan(client, auth):
    from .conftest import register

    plan = client.post(f"{API}/events", json={"event_type": "travel", "key_date": days(30)}, headers=auth).json()
    other = register(client, "mallory@test.dev")
    assert client.get(f"{API}/events/{plan['id']}", headers=other).status_code == 404
    assert client.patch(f"{API}/tasks/{plan['tasks'][0]['id']}", json={"title": "x"}, headers=other).status_code == 404
