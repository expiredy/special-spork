"""Small SMTP adapter for account verification and approval notices.

Verification links are deliberately omitted from logs unless the developer-only
FLOWCOST_DEV_EMAIL_LOG_LINKS switch is explicitly enabled.
"""
from __future__ import annotations

import logging
import os
import smtplib
import ssl
from email.message import EmailMessage
from urllib.parse import urlencode

logger = logging.getLogger("flowcost.email")


def _masked_email(address: str) -> str:
    local, separator, domain = address.partition("@")
    if not separator:
        return "(invalid email)"
    visible = local[:1] if local else "*"
    return f"{visible}{'*' * min(max(len(local) - 1, 3), 8)}@{domain}"


def verification_url(token: str) -> str:
    base = os.getenv("FLOWCOST_PUBLIC_URL", "http://localhost:5173").strip().rstrip("/")
    return f"{base}/?{urlencode({'verify_email': token})}"


def send_email(to_address: str, subject: str, body: str) -> str:
    """Return 'sent', 'logged' or 'unavailable'; never expose delivery secrets to clients."""
    host = os.getenv("FLOWCOST_SMTP_HOST", "").strip()
    sender = os.getenv("FLOWCOST_SMTP_FROM", "").strip()
    username = os.getenv("FLOWCOST_SMTP_USERNAME", "").strip()
    password = os.getenv("FLOWCOST_SMTP_PASSWORD", "")
    try:
        port = int(os.getenv("FLOWCOST_SMTP_PORT", "587"))
    except ValueError:
        logger.error("FLOWCOST_SMTP_PORT must be an integer")
        return "unavailable"
    starttls = os.getenv("FLOWCOST_SMTP_STARTTLS", "true").strip().lower() in {"1", "true", "yes", "on"}

    if not host or not sender:
        if os.getenv("FLOWCOST_DEV_EMAIL_LOG_LINKS", "false").strip().lower() in {"1", "true", "yes", "on"}:
            # Explicit local-development fallback only. Never enable this on a public server.
            logger.warning("DEV ONLY email to %s | %s\n%s", _masked_email(to_address), subject, body)
            return "logged"
        logger.error("Email delivery is unavailable: configure FLOWCOST_SMTP_HOST and FLOWCOST_SMTP_FROM")
        return "unavailable"

    message = EmailMessage()
    message["From"] = sender
    message["To"] = to_address
    message["Subject"] = subject
    message.set_content(body)
    try:
        with smtplib.SMTP(host, port, timeout=15) as server:
            server.ehlo()
            if starttls:
                server.starttls(context=ssl.create_default_context())
                server.ehlo()
            if username:
                server.login(username, password)
            server.send_message(message)
        logger.info("Email sent to %s", _masked_email(to_address))
        return "sent"
    except (OSError, smtplib.SMTPException) as exc:
        logger.error("Could not send email to %s (%s)", _masked_email(to_address), type(exc).__name__)
        return "unavailable"


def send_verification_email(email: str, username: str, token: str) -> str:
    link = verification_url(token)
    body = (
        f"Здравствуйте, {username}!\n\n"
        "Чтобы подтвердить адрес электронной почты FlowCost, откройте ссылку ниже. "
        "Ссылка действует 24 часа и может быть использована только один раз.\n\n"
        f"{link}\n\n"
        "После подтверждения адреса администратор должен одобрить регистрацию.\n"
        "Если вы не создавали аккаунт, просто проигнорируйте это письмо."
    )
    return send_email(email, "Подтверждение email для FlowCost", body)


def send_approval_email(email: str, username: str) -> str:
    url = os.getenv("FLOWCOST_PUBLIC_URL", "http://localhost:5173").strip().rstrip("/")
    body = (
        f"Здравствуйте, {username}!\n\n"
        "Администратор одобрил вашу регистрацию в FlowCost. Теперь вы можете войти в аккаунт:\n"
        f"{url}\n"
    )
    return send_email(email, "Ваша регистрация FlowCost одобрена", body)
