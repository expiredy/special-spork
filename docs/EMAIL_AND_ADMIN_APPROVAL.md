# Email verification and admin approval

## Account lifecycle

1. Registration validates username, required email and password.
2. The user is created with `approval_status='pending'` and no authenticated session.
3. A cryptographically random, single-use email verification token is issued. Only its SHA-256 hash is stored, and the token expires after 24 hours.
4. Clicking the email link calls `POST /api/auth/verify-email`. Verification marks the email as verified but does not approve the account.
5. An administrator signs in using credentials provisioned from `backend/.env` and opens `/team/admin`.
6. The admin can approve only accounts with verified email. Approval records `approved_by` and `approved_at` and sends a notification email.
7. Login and all authenticated API/WebSocket activity require both a verified email and `approval_status='approved'`.

## Environment variables

See `backend/.env.example`. Important variables:

- `FLOWCOST_ADMIN_USERNAME`, `FLOWCOST_ADMIN_EMAIL`, `FLOWCOST_ADMIN_PASSWORD`: bootstrap administrator identity. All three must be set together. Password must have at least 12 characters.
- `FLOWCOST_SMTP_HOST`, `FLOWCOST_SMTP_PORT`, `FLOWCOST_SMTP_USERNAME`, `FLOWCOST_SMTP_PASSWORD`, `FLOWCOST_SMTP_FROM`, `FLOWCOST_SMTP_STARTTLS`: outbound SMTP.
- `FLOWCOST_PUBLIC_URL`: public frontend base used when composing verification links.
- `FLOWCOST_DEV_EMAIL_LOG_LINKS`: **local development only**, lets the backend log a verification link if SMTP is unconfigured. Set to `false` in production.

The backend reads `backend/.env` using python-dotenv without overriding variables already set in the process environment. If all three admin variables are removed, the next startup clears stored admin roles; configure them together to keep admin access enabled.

## Existing database migration

The schema migration adds verification/approval columns and a token table. Existing accounts are not auto-verified or auto-approved. A legacy account with an email can request a verification message from the login page. If it has no email, an admin can add one on `/team/admin`, which invalidates sessions and sends a verification message; the user must verify it and then the admin must approve the account.

## Admin UI and API

- `GET /api/admin/registrations` — pending and rejected non-admin registrations.
- `POST /api/admin/registrations/{user_id}/approve` — requires verified email and admin role.
- `POST /api/admin/registrations/{user_id}/reject` — rejects and revokes sessions.
- `POST /api/admin/registrations/{user_id}/resend-verification` — reissue verification email.
- `POST /api/admin/registrations/{user_id}/set-email` — set/correct email, reset verification and approval, revoke sessions, and send a new link.
- `POST /api/auth/resend-verification` — public, non-enumerating response for a username/email pair.

## Operational security notes

- Keep `backend/.env` private and do not put credentials into archives or Git.
- Disable `FLOWCOST_DEV_EMAIL_LOG_LINKS` outside local development. Verification URLs are bearer secrets.
- Use HTTPS for the frontend and WSS for collaboration when deployed.
- Add rate limiting / abuse monitoring in a public deployment; these are not yet built into this prototype.
- The app uses scrypt with random per-user salts for passwords, short-lived single-use verification tokens, and admin checks on the server.
- Admin credentials in `.env` are the source of truth: backend startup ensures that account exists and resets its password hash if the configured password changes.
