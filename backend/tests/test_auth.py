from settlewise.core.security import totp_code

from .conftest import register

API = "/api/v1"


def test_register_login_and_me(client):
    register(client, "a@test.dev", "password-123")
    assert (
        client.post(f"{API}/auth/register", json={"email": "a@test.dev", "password": "password-123"}).status_code == 409
    )
    assert client.post(f"{API}/auth/login", json={"email": "a@test.dev", "password": "wrong-pass"}).status_code == 401
    token = client.post(f"{API}/auth/login", json={"email": "A@test.dev", "password": "password-123"}).json()
    me = client.get(f"{API}/account/me", headers={"Authorization": f"Bearer {token['access_token']}"})
    assert me.json()["email"] == "a@test.dev"
    assert client.get(f"{API}/account/me").status_code == 401


def test_two_step_verification(client, auth):
    secret = client.post(f"{API}/auth/2fa/setup", headers=auth).json()["secret"]
    assert client.post(f"{API}/auth/2fa/enable", json={"code": "000000"}, headers=auth).status_code == 400
    assert client.post(f"{API}/auth/2fa/enable", json={"code": totp_code(secret)}, headers=auth).json()["totp_enabled"]
    creds = {"email": "sarah@test.dev", "password": "correct-horse-1"}
    res = client.post(f"{API}/auth/login", json=creds)
    assert res.status_code == 401 and res.json()["detail"] == "totp_required"
    assert client.post(f"{API}/auth/login", json={**creds, "totp_code": totp_code(secret)}).status_code == 200


def test_password_change_signs_out_other_sessions(client, auth):
    res = client.post(
        f"{API}/auth/password/change",
        json={"current_password": "correct-horse-1", "new_password": "new-password-9"},
        headers=auth,
    )
    assert res.status_code == 200
    assert client.get(f"{API}/account/me", headers=auth).status_code == 401
    fresh = {"Authorization": f"Bearer {res.json()['access_token']}"}
    assert client.get(f"{API}/account/me", headers=fresh).status_code == 200


def test_password_reset(client, auth):
    token = client.post(f"{API}/auth/password/reset-request", json={"email": "sarah@test.dev"}).json()["dev_token"]
    assert (
        client.post(f"{API}/auth/password/reset", json={"token": token, "new_password": "reset-pass-1"}).status_code
        == 204
    )
    assert (
        client.post(f"{API}/auth/password/reset", json={"token": token, "new_password": "again-pass-1"}).status_code
        == 400
    )
    assert (
        client.post(f"{API}/auth/login", json={"email": "sarah@test.dev", "password": "reset-pass-1"}).status_code
        == 200
    )


def test_language_export_and_delete(client, auth):
    assert (
        client.patch(f"{API}/account/me", json={"display_language": "fr"}, headers=auth).json()["display_language"]
        == "fr"
    )
    assert client.patch(f"{API}/account/me", json={"display_language": "xx"}, headers=auth).status_code == 422
    client.post(f"{API}/events", json={"event_type": "travel", "key_date": "2030-01-10"}, headers=auth)
    export = client.get(f"{API}/account/export", headers=auth).json()
    assert export["account"]["email"] == "sarah@test.dev"
    assert export["planning"]["life_events"][0]["event_type"] == "travel"
    assert export["tasks"]["tasks"]
    assert client.post(f"{API}/account/delete", json={"password": "nope"}, headers=auth).status_code == 400
    assert client.post(f"{API}/account/delete", json={"password": "correct-horse-1"}, headers=auth).status_code == 204
    assert (
        client.post(f"{API}/auth/login", json={"email": "sarah@test.dev", "password": "correct-horse-1"}).status_code
        == 401
    )
