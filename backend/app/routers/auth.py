from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import sqlite3
from datetime import datetime, timezone, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from ..services.email_delivery import send_approval_email, send_verification_email

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _valid_email(value: str) -> bool:
    return len(value) <= 254 and bool(EMAIL_RE.fullmatch(value.strip()))


def create_auth_router(context: dict[str, Any]):
    db_conn = context["db_conn"]
    now_iso = context["now_iso"]
    new_id = context["new_id"]
    password_digest = context["password_digest"]
    SESSION_DAYS = context["SESSION_DAYS"]
    EMAIL_VERIFICATION_HOURS = context.get("EMAIL_VERIFICATION_HOURS", 24)
    router = APIRouter()

    def create_verification_token(conn, user_id: str, stamp: str) -> str:
        token = secrets.token_urlsafe(40)
        conn.execute("DELETE FROM email_verification_tokens WHERE user_id = ? AND used_at IS NULL", (user_id,))
        expires = (datetime.now(timezone.utc) + timedelta(hours=EMAIL_VERIFICATION_HOURS)).replace(microsecond=0).isoformat()
        conn.execute(
            "INSERT INTO email_verification_tokens (token_hash, user_id, expires_at, created_at, used_at) VALUES (?, ?, ?, ?, NULL)",
            (_token_hash(token), user_id, expires, stamp),
        )
        return token

    def admin_user(request: Request) -> dict[str, Any]:
        user = getattr(request.state, "user", None)
        if not user or not user.get("is_admin"):
            raise HTTPException(status_code=403, detail="Для этого действия нужны права администратора.")
        return user

    @router.post("/api/auth/register")
    def register(payload: dict[str, Any]) -> dict[str, Any]:
        username = str(payload.get("username") or "").strip()
        email = str(payload.get("email") or "").strip()
        password = str(payload.get("password") or "")
        if len(username) < 3 or len(username) > 40 or not all(ch.isalnum() or ch in ".-_" for ch in username):
            raise HTTPException(status_code=400, detail="Логин должен содержать 3–40 символов: буквы, цифры, точку, дефис или подчёркивание.")
        if not _valid_email(email):
            raise HTTPException(status_code=400, detail="Укажите корректный email — без подтверждения адреса пользоваться FlowCost нельзя.")
        if len(password) < 8:
            raise HTTPException(status_code=400, detail="Пароль должен содержать не менее 8 символов.")

        salt = secrets.token_hex(16)
        digest = password_digest(password, salt)
        user_id = new_id("user-")
        stamp = now_iso()
        try:
            with db_conn() as conn:
                duplicate = conn.execute(
                    "SELECT id FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE LIMIT 1",
                    (username, email),
                ).fetchone()
                if duplicate:
                    raise HTTPException(status_code=409, detail="Логин или email уже используются.")
                conn.execute(
                    """INSERT INTO users
                       (id, username, email, password_hash, password_salt, created_at, email_verified_at,
                        approval_status, approved_by, approved_at, is_admin)
                       VALUES (?, ?, ?, ?, ?, ?, NULL, 'pending', NULL, NULL, 0)""",
                    (user_id, username, email, digest, salt, stamp),
                )
                verification_token = create_verification_token(conn, user_id, stamp)
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=409, detail="Логин или email уже используются.")

        delivery = send_verification_email(email, username, verification_token)
        if delivery == "sent":
            message = "Аккаунт создан. Мы отправили письмо для подтверждения email. После подтверждения адреса администратор должен одобрить регистрацию."
        elif delivery == "logged":
            message = "Аккаунт создан. SMTP не настроен: ссылка для подтверждения записана в консоль backend только для локальной разработки. После подтверждения потребуется одобрение администратора."
        else:
            message = "Аккаунт создан, но письмо отправить не удалось. Администратору нужно настроить SMTP; затем запросите письмо повторно."
        return {"status": "pending_verification", "email": email, "email_delivery": delivery, "message": message}

    @router.post("/api/auth/login")
    def login(payload: dict[str, Any]) -> dict[str, Any]:
        username = str(payload.get("username") or "").strip()
        password = str(payload.get("password") or "")
        with db_conn() as conn:
            row = conn.execute("SELECT * FROM users WHERE username = ? COLLATE NOCASE", (username,)).fetchone()
        if not row or not hmac.compare_digest(password_digest(password, row["password_salt"]), row["password_hash"]):
            raise HTTPException(status_code=401, detail="Неверный логин или пароль.")
        if not str(row["email"] or "").strip():
            raise HTTPException(status_code=403, detail="Для использования FlowCost к аккаунту должен быть привязан email. Обратитесь к администратору.")
        if not row["email_verified_at"]:
            raise HTTPException(status_code=403, detail="Подтвердите email. Проверьте почту или запросите письмо повторно.")
        if row["approval_status"] == "rejected":
            raise HTTPException(status_code=403, detail="Регистрация отклонена администратором.")
        if row["approval_status"] != "approved":
            raise HTTPException(status_code=403, detail="Email подтверждён. Регистрация ожидает одобрения администратора.")

        token = secrets.token_urlsafe(36)
        stamp = now_iso()
        expires = (datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)).replace(microsecond=0).isoformat()
        with db_conn() as conn:
            conn.execute("INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)", (token, row["id"], expires, stamp))
        return {"token": token, "user": {"id": row["id"], "username": row["username"], "email": row["email"], "is_admin": bool(row["is_admin"])}}

    @router.post("/api/auth/verify-email")
    def verify_email(payload: dict[str, Any]) -> dict[str, Any]:
        token = str(payload.get("token") or "").strip()
        if not token or len(token) > 256:
            raise HTTPException(status_code=400, detail="Ссылка подтверждения недействительна или устарела.")
        stamp = now_iso()
        with db_conn() as conn:
            row = conn.execute(
                """SELECT t.user_id, t.expires_at, t.used_at, u.email_verified_at, u.approval_status
                   FROM email_verification_tokens t JOIN users u ON u.id = t.user_id
                   WHERE t.token_hash = ?""",
                (_token_hash(token),),
            ).fetchone()
            if not row or row["expires_at"] < stamp:
                raise HTTPException(status_code=400, detail="Ссылка подтверждения недействительна или устарела. Запросите новое письмо.")
            if not row["used_at"]:
                conn.execute("UPDATE users SET email_verified_at = ? WHERE id = ?", (stamp, row["user_id"]))
                conn.execute("UPDATE email_verification_tokens SET used_at = ? WHERE token_hash = ?", (stamp, _token_hash(token)))
            status = row["approval_status"]
        return {
            "status": "already_verified" if row["used_at"] else "verified",
            "approval_status": status,
            "message": "Email подтверждён. Теперь дождитесь одобрения администратора." if status != "approved" else "Email подтверждён. Теперь можно войти в FlowCost.",
        }

    @router.post("/api/auth/resend-verification")
    def resend_verification(payload: dict[str, Any]) -> dict[str, str]:
        # Identical response regardless of whether the account/email exists.
        username = str(payload.get("username") or "").strip()
        email = str(payload.get("email") or "").strip()
        if username and _valid_email(email):
            stamp = now_iso()
            verification_token = None
            with db_conn() as conn:
                row = conn.execute(
                    "SELECT id, username, email, email_verified_at, approval_status, is_admin FROM users WHERE username = ? COLLATE NOCASE AND email = ? COLLATE NOCASE",
                    (username, email),
                ).fetchone()
                if row and not row["email_verified_at"] and row["approval_status"] != "rejected" and not row["is_admin"]:
                    verification_token = create_verification_token(conn, row["id"], stamp)
                    saved_username = row["username"]
            if verification_token:
                send_verification_email(email, saved_username, verification_token)
        return {"message": "Если логин и email совпадают с неподтверждённым аккаунтом, мы отправили новое письмо."}

    @router.get("/api/auth/me")
    def auth_me(request: Request) -> dict[str, Any]:
        return request.state.user

    @router.post("/api/auth/logout")
    def auth_logout(request: Request) -> dict[str, bool]:
        header = request.headers.get("authorization", "")
        token = header[7:].strip() if header.lower().startswith("bearer ") else ""
        with db_conn() as conn:
            conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        return {"ok": True}

    @router.get("/api/admin/registrations")
    def admin_registrations(request: Request) -> list[dict[str, Any]]:
        admin_user(request)
        with db_conn() as conn:
            rows = conn.execute(
                """SELECT id, username, email, email_verified_at, approval_status, created_at, approved_at
                   FROM users WHERE is_admin = 0 AND approval_status <> 'approved'
                   ORDER BY CASE approval_status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC"""
            ).fetchall()
        return [dict(row) for row in rows]

    @router.post("/api/admin/registrations/{user_id}/approve")
    def approve_registration(user_id: str, request: Request) -> dict[str, Any]:
        admin = admin_user(request)
        stamp = now_iso()
        with db_conn() as conn:
            row = conn.execute("SELECT id, username, email, email_verified_at, is_admin FROM users WHERE id = ?", (user_id,)).fetchone()
            if not row or row["is_admin"]:
                raise HTTPException(status_code=404, detail="Регистрация не найдена.")
            if not row["email"] or not row["email_verified_at"]:
                raise HTTPException(status_code=409, detail="Нельзя одобрить регистрацию до подтверждения email.")
            conn.execute(
                "UPDATE users SET approval_status = 'approved', approved_by = ?, approved_at = ? WHERE id = ?",
                (admin["id"], stamp, user_id),
            )
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        send_approval_email(row["email"], row["username"])
        return {"ok": True, "user_id": user_id, "approval_status": "approved"}

    @router.post("/api/admin/registrations/{user_id}/reject")
    def reject_registration(user_id: str, request: Request) -> dict[str, Any]:
        admin_user(request)
        with db_conn() as conn:
            row = conn.execute("SELECT id, is_admin FROM users WHERE id = ?", (user_id,)).fetchone()
            if not row or row["is_admin"]:
                raise HTTPException(status_code=404, detail="Регистрация не найдена.")
            conn.execute("UPDATE users SET approval_status = 'rejected', approved_by = NULL, approved_at = NULL WHERE id = ?", (user_id,))
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
            conn.execute("DELETE FROM email_verification_tokens WHERE user_id = ?", (user_id,))
        return {"ok": True, "user_id": user_id, "approval_status": "rejected"}

    @router.post("/api/admin/registrations/{user_id}/resend-verification")
    def admin_resend_verification(user_id: str, request: Request) -> dict[str, Any]:
        admin_user(request)
        stamp = now_iso()
        with db_conn() as conn:
            row = conn.execute("SELECT id, username, email, email_verified_at, is_admin, approval_status FROM users WHERE id = ?", (user_id,)).fetchone()
            if not row or row["is_admin"]:
                raise HTTPException(status_code=404, detail="Регистрация не найдена.")
            if not row["email"]:
                raise HTTPException(status_code=409, detail="Сначала укажите email для этого аккаунта.")
            if row["email_verified_at"]:
                raise HTTPException(status_code=409, detail="Этот email уже подтверждён.")
            if row["approval_status"] == "rejected":
                raise HTTPException(status_code=409, detail="Сначала измените статус регистрации.")
            token = create_verification_token(conn, row["id"], stamp)
        delivery = send_verification_email(row["email"], row["username"], token)
        return {"ok": delivery in {"sent", "logged"}, "email_delivery": delivery}

    @router.post("/api/admin/registrations/{user_id}/set-email")
    def admin_set_email(user_id: str, payload: dict[str, Any], request: Request) -> dict[str, Any]:
        admin_user(request)
        email = str(payload.get("email") or "").strip()
        if not _valid_email(email):
            raise HTTPException(status_code=400, detail="Укажите корректный email.")
        stamp = now_iso()
        with db_conn() as conn:
            row = conn.execute("SELECT id, username, is_admin FROM users WHERE id = ?", (user_id,)).fetchone()
            if not row or row["is_admin"]:
                raise HTTPException(status_code=404, detail="Пользователь не найден.")
            email_owner = conn.execute("SELECT id FROM users WHERE email = ? COLLATE NOCASE AND email <> '' AND id <> ?", (email, user_id)).fetchone()
            if email_owner:
                raise HTTPException(status_code=409, detail="Этот email уже связан с другим аккаунтом.")
            conn.execute(
                "UPDATE users SET email = ?, email_verified_at = NULL, approval_status = 'pending', approved_by = NULL, approved_at = NULL WHERE id = ?",
                (email, user_id),
            )
            conn.execute("DELETE FROM email_verification_tokens WHERE user_id = ?", (user_id,))
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
            token = create_verification_token(conn, user_id, stamp)
        delivery = send_verification_email(email, row["username"], token)
        return {"ok": delivery in {"sent", "logged"}, "email_delivery": delivery, "message": "Email обновлён; после подтверждения адреса регистрация снова потребует одобрения."}

    return router, {
        "register": register, "login": login, "auth_me": auth_me, "auth_logout": auth_logout,
        "verify_email": verify_email, "resend_verification": resend_verification,
        "admin_registrations": admin_registrations, "approve_registration": approve_registration,
        "reject_registration": reject_registration,
    }
