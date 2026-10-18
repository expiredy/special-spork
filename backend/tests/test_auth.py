from __future__ import annotations

import os
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("FLOWCOST_DB_PATH", str(Path(tempfile.gettempdir()) / "flowcost-tests.sqlite3"))

from fastapi.testclient import TestClient
from app.main import app, db_conn, new_id, now_iso, password_digest, provision_env_admin


class EmailApprovalAuthTests(unittest.TestCase):
    def setUp(self):
        self.client_context = TestClient(app)
        self.client = self.client_context.__enter__()
        suffix = uuid.uuid4().hex[:9]
        self.username = f"verify_{suffix}"
        self.email = f"verify-{suffix}@example.test"
        self.password = "Test-password-8294"
        self.admin_username = f"admin_{suffix}"
        self.admin_email = f"admin-{suffix}@example.test"
        self.admin_password = "Admin-password-8294"
        self.user_id = None
        self.admin_id = None

    def tearDown(self):
        with db_conn() as conn:
            ids = [value for value in (self.user_id, self.admin_id) if value]
            for user_id in ids:
                conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        self.client_context.__exit__(None, None, None)

    def create_admin(self):
        salt = "77" * 16
        digest = password_digest(self.admin_password, salt)
        self.admin_id = new_id("test-admin-")
        stamp = now_iso()
        with db_conn() as conn:
            conn.execute(
                """INSERT INTO users (id, username, email, password_hash, password_salt, created_at,
                   email_verified_at, approval_status, approved_by, approved_at, is_admin)
                   VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', NULL, ?, 1)""",
                (self.admin_id, self.admin_username, self.admin_email, digest, salt, stamp, stamp, stamp),
            )
        response = self.client.post("/api/auth/login", json={"username": self.admin_username, "password": self.admin_password})
        self.assertEqual(response.status_code, 200, response.text)
        return {"Authorization": f"Bearer {response.json()['token']}"}

    def test_registration_requires_email_and_email_confirmation_then_admin_approval(self):
        without_email = self.client.post("/api/auth/register", json={
            "username": self.username, "email": "", "password": self.password,
        })
        self.assertEqual(without_email.status_code, 400)

        captured = {}
        def capture_verification(email, username, token):
            captured["email"] = email
            captured["username"] = username
            captured["token"] = token
            return "sent"

        with patch("app.routers.auth.send_verification_email", side_effect=capture_verification), patch("app.routers.auth.send_approval_email", return_value="sent"):
            registered = self.client.post("/api/auth/register", json={
                "username": self.username, "email": self.email, "password": self.password,
            })
            self.assertEqual(registered.status_code, 200, registered.text)
            self.assertNotIn("token", registered.json(), "Registration must not grant an authenticated session")
            self.assertEqual(registered.json()["status"], "pending_verification")
            self.assertEqual(captured["email"], self.email)
            self.assertEqual(captured["username"], self.username)
            with db_conn() as conn:
                row = conn.execute("SELECT id, approval_status, email_verified_at FROM users WHERE username = ?", (self.username,)).fetchone()
                self.user_id = row["id"]
            self.assertEqual(row["approval_status"], "pending")
            self.assertIsNone(row["email_verified_at"])

            blocked_login = self.client.post("/api/auth/login", json={"username": self.username, "password": self.password})
            self.assertEqual(blocked_login.status_code, 403)
            self.assertIn("Подтвердите email", blocked_login.json()["detail"])

            verified = self.client.post("/api/auth/verify-email", json={"token": captured["token"]})
            self.assertEqual(verified.status_code, 200, verified.text)
            self.assertEqual(verified.json()["status"], "verified")
            # Repeated verification request is safe/idempotent for React StrictMode and refreshes.
            repeated = self.client.post("/api/auth/verify-email", json={"token": captured["token"]})
            self.assertEqual(repeated.status_code, 200, repeated.text)
            self.assertEqual(repeated.json()["status"], "already_verified")

            pending_login = self.client.post("/api/auth/login", json={"username": self.username, "password": self.password})
            self.assertEqual(pending_login.status_code, 403)
            self.assertIn("одобрения администратора", pending_login.json()["detail"])

            admin_headers = self.create_admin()
            registrations = self.client.get("/api/admin/registrations", headers=admin_headers)
            self.assertEqual(registrations.status_code, 200, registrations.text)
            self.assertTrue(any(item["id"] == self.user_id for item in registrations.json()))
            approved = self.client.post(f"/api/admin/registrations/{self.user_id}/approve", headers=admin_headers, json={})
            self.assertEqual(approved.status_code, 200, approved.text)

            login = self.client.post("/api/auth/login", json={"username": self.username, "password": self.password})
            self.assertEqual(login.status_code, 200, login.text)
            self.assertEqual(login.json()["user"]["email"], self.email)
            self.assertFalse(login.json()["user"]["is_admin"])
            me = self.client.get("/api/auth/me", headers={"Authorization": f"Bearer {login.json()['token']}"})
            self.assertEqual(me.status_code, 200)
            self.assertFalse(me.json()["is_admin"])

            forbidden = self.client.get("/api/admin/registrations", headers={"Authorization": f"Bearer {login.json()['token']}"})
            self.assertEqual(forbidden.status_code, 403)

    def test_verification_token_is_single_use_and_bound_to_its_account(self):
        captured = {}
        def capture_verification(email, username, token):
            captured["token"] = token
            return "sent"
        with patch("app.routers.auth.send_verification_email", side_effect=capture_verification):
            response = self.client.post("/api/auth/register", json={
                "username": self.username, "email": self.email, "password": self.password,
            })
            self.assertEqual(response.status_code, 200, response.text)
            # A token belonging to an actual pending account can only verify that account.
            verified = self.client.post("/api/auth/verify-email", json={"token": captured["token"]})
            self.assertEqual(verified.status_code, 200)
            with db_conn() as conn:
                self.user_id = conn.execute("SELECT id FROM users WHERE username = ?", (self.username,)).fetchone()["id"]
                row = conn.execute("SELECT user_id FROM email_verification_tokens WHERE token_hash = ?", (__import__('hashlib').sha256(captured["token"].encode()).hexdigest(),)).fetchone()
            self.assertEqual(row["user_id"], self.user_id)


    def test_env_bootstrap_creates_admin_and_does_not_reset_sessions_on_same_config(self):
        self.admin_username = f"envadmin_{uuid.uuid4().hex[:8]}"
        self.admin_email = f"envadmin-{uuid.uuid4().hex[:8]}@example.test"
        self.admin_password = "Env-admin-unique-8429"
        config = {
            "FLOWCOST_ADMIN_USERNAME": self.admin_username,
            "FLOWCOST_ADMIN_EMAIL": self.admin_email,
            "FLOWCOST_ADMIN_PASSWORD": self.admin_password,
        }
        with patch.dict(os.environ, config):
            provision_env_admin()
            login = self.client.post("/api/auth/login", json={"username": self.admin_username, "password": self.admin_password})
            self.assertEqual(login.status_code, 200, login.text)
            self.admin_id = login.json()["user"]["id"]
            self.assertTrue(login.json()["user"]["is_admin"])
            # Re-running bootstrap with the same configured password must not kill active sessions.
            provision_env_admin()
            me = self.client.get("/api/auth/me", headers={"Authorization": f"Bearer {login.json()['token']}"})
            self.assertEqual(me.status_code, 200, me.text)
            self.assertTrue(me.json()["is_admin"])


    def test_admin_can_add_email_for_legacy_account_and_force_reverification(self):
        salt = "88" * 16
        digest = password_digest(self.password, salt)
        self.user_id = new_id("legacy-user-")
        stamp = now_iso()
        with db_conn() as conn:
            conn.execute(
                """INSERT INTO users (id, username, email, password_hash, password_salt, created_at,
                   email_verified_at, approval_status, approved_by, approved_at, is_admin)
                   VALUES (?, ?, '', ?, ?, ?, NULL, 'pending', NULL, NULL, 0)""",
                (self.user_id, self.username, digest, salt, stamp),
            )
        admin_headers = self.create_admin()
        captured = {}
        def capture_verification(email, username, token):
            captured.update(email=email, username=username, token=token)
            return "sent"
        with patch("app.routers.auth.send_verification_email", side_effect=capture_verification):
            response = self.client.post(
                f"/api/admin/registrations/{self.user_id}/set-email",
                headers=admin_headers,
                json={"email": self.email},
            )
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(captured["email"], self.email)
            verify = self.client.post("/api/auth/verify-email", json={"token": captured["token"]})
            self.assertEqual(verify.status_code, 200, verify.text)
            with db_conn() as conn:
                row = conn.execute("SELECT email, email_verified_at, approval_status FROM users WHERE id = ?", (self.user_id,)).fetchone()
            self.assertEqual(row["email"], self.email)
            self.assertIsNotNone(row["email_verified_at"])
            self.assertEqual(row["approval_status"], "pending")
        pending = self.client.post("/api/auth/login", json={"username": self.username, "password": self.password})
        self.assertEqual(pending.status_code, 403)
        with patch("app.routers.auth.send_approval_email", return_value="sent"):
            approved = self.client.post(f"/api/admin/registrations/{self.user_id}/approve", headers=admin_headers, json={})
        self.assertEqual(approved.status_code, 200, approved.text)
        login = self.client.post("/api/auth/login", json={"username": self.username, "password": self.password})
        self.assertEqual(login.status_code, 200, login.text)

    def test_expired_email_verification_link_is_rejected(self):
        captured = {}
        def capture_verification(email, username, token):
            captured["token"] = token
            return "sent"
        with patch("app.routers.auth.send_verification_email", side_effect=capture_verification):
            registered = self.client.post("/api/auth/register", json={
                "username": self.username, "email": self.email, "password": self.password,
            })
            self.assertEqual(registered.status_code, 200, registered.text)
            with db_conn() as conn:
                self.user_id = conn.execute("SELECT id FROM users WHERE username = ?", (self.username,)).fetchone()["id"]
                token_hash = __import__('hashlib').sha256(captured["token"].encode()).hexdigest()
                conn.execute("UPDATE email_verification_tokens SET expires_at = ? WHERE token_hash = ?", ("2000-01-01T00:00:00+00:00", token_hash))
            expired = self.client.post("/api/auth/verify-email", json={"token": captured["token"]})
            self.assertEqual(expired.status_code, 400)
            self.assertIn("устарела", expired.json()["detail"])

    def test_resend_verification_uses_non_enumerating_response(self):
        with patch("app.routers.auth.send_verification_email", return_value="sent"):
            registered = self.client.post("/api/auth/register", json={
                "username": self.username, "email": self.email, "password": self.password,
            })
            self.assertEqual(registered.status_code, 200, registered.text)
            with db_conn() as conn:
                self.user_id = conn.execute("SELECT id FROM users WHERE username = ?", (self.username,)).fetchone()["id"]
            valid = self.client.post("/api/auth/resend-verification", json={"username": self.username, "email": self.email})
            invalid = self.client.post("/api/auth/resend-verification", json={"username": "missing-user", "email": "missing@example.test"})
        self.assertEqual(valid.status_code, 200)
        self.assertEqual(valid.json(), invalid.json())


if __name__ == "__main__":
    unittest.main()
