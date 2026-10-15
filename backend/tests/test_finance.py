from datetime import date, timedelta

from .conftest import days

API = "/api/v1"


def test_budget_summary_and_expenses(client, auth):
    budget = client.post(f"{API}/finance/budgets", json={"name": "Monthly"}, headers=auth).json()
    for line in [
        {"kind": "income", "label": "Salary", "amount": 4000, "category": "salary"},
        {"kind": "expense", "label": "Groceries", "amount": 500, "category": "food"},
    ]:
        assert client.post(f"{API}/finance/budgets/{budget['id']}/lines", json=line, headers=auth).status_code == 201
    client.post(
        f"{API}/finance/expenses",
        json={"amount": 120.5, "category": "food", "spent_on": date.today().isoformat(), "budget_id": budget["id"]},
        headers=auth,
    )
    summary = client.get(f"{API}/finance/budgets/{budget['id']}/summary", headers=auth).json()
    assert summary["income"] == 4000
    food = next(c for c in summary["categories"] if c["category"] == "food")
    assert food == {"category": "food", "planned": 500, "actual": 120.5, "remaining": 379.5}


def test_forecast_includes_bills_and_event_costs(client, auth):
    client.post(
        f"{API}/finance/bills",
        json={"name": "Phone", "amount": 50, "frequency": "weekly", "next_due_date": days(1)},
        headers=auth,
    )
    plan = client.post(f"{API}/events", json={"event_type": "travel", "key_date": days(60)}, headers=auth).json()
    forecast = client.get(f"{API}/finance/forecast", params={"days": 30, "starting_balance": 1000}, headers=auth).json()
    bill_flows = [f for f in forecast["flows"] if f["source"] == "bill"]
    assert len(bill_flows) == 5  # days 1, 8, 15, 22, 29
    flights = next(f for f in forecast["flows"] if f["label"] == "Flights")  # due key-45 = day 15
    assert flights["date"] == days(15) and flights["life_event_id"] == plan["id"]
    assert forecast["ending_balance"] == 1000 - 250 - 1500
    assert forecast["lowest"]["balance"] < 0 and forecast["warnings"]


def test_bill_paid_advances_and_goal_contribution(client, auth):
    bill = client.post(
        f"{API}/finance/bills",
        json={"name": "Rent", "amount": 2000, "frequency": "monthly", "next_due_date": "2030-01-31"},
        headers=auth,
    ).json()
    assert client.post(f"{API}/finance/bills/{bill['id']}/paid", headers=auth).json()["next_due_date"] == "2030-02-28"
    goal = client.post(
        f"{API}/finance/goals",
        json={"name": "Emergency fund", "kind": "emergency", "target_amount": 6000},
        headers=auth,
    ).json()
    goal = client.post(f"{API}/finance/goals/{goal['id']}/contribute", json={"amount": 250}, headers=auth).json()
    assert goal["saved_amount"] == 250
    overview = client.get(f"{API}/finance/overview", headers=auth).json()
    assert overview["goals"][0]["percent"] == 4


def test_cost_dates_follow_key_date(client, auth):
    key = date.today() + timedelta(days=90)
    plan = client.post(f"{API}/events", json={"event_type": "moving", "key_date": key.isoformat()}, headers=auth).json()
    costs = client.get(f"{API}/finance/event-costs", params={"life_event_id": plan["id"]}, headers=auth).json()
    movers = next(c for c in costs if c["label"].startswith("Movers"))
    assert movers["due_date"] == key.isoformat()
