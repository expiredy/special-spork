# FlowCost 0.5.4 — email verification and admin approval

## What changed

- Registration requires an email address and does not create an authenticated session.
- Email confirmation uses a random one-time token; only the SHA-256 hash is stored, and links expire after 24 hours.
- New accounts remain pending until an administrator approves them.
- The administrator identity is provisioned from `backend/.env` using `FLOWCOST_ADMIN_USERNAME`, `FLOWCOST_ADMIN_EMAIL`, and `FLOWCOST_ADMIN_PASSWORD`.
- Added `/team/admin` for reviewing, approving, rejecting, and helping users with email verification.
- Added configurable SMTP delivery via `FLOWCOST_SMTP_*`; local-only verification-link logging is an explicit development switch.
- Existing accounts are not silently treated as email-verified or approved during database migration.

## Before running

1. Copy `backend/.env.example` to `backend/.env`.
2. Replace the admin username, email, and placeholder password. The admin password must be at least 12 characters.
3. For actual users, configure SMTP and set `FLOWCOST_DEV_EMAIL_LOG_LINKS=false`.
4. Set `FLOWCOST_PUBLIC_URL` to the frontend URL visible to users.
5. Keep `backend/.env` and the SQLite database private; neither is included in the source archive.

## Validation performed

- Backend unit tests: 20 passed.
- Collaboration integration smoke test: passed.
- Frontend Node tests: 6 passed.
- React/JSX transpilation syntax check: 21 files passed.
- Full Vite production build was not verified because npm dependency installation timed out in the build environment. Run `npm install` and `npm run build` in `frontend/` locally before deploying.
