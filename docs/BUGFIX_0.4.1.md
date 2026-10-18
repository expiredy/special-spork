# FlowCost 0.4.1 — CORS and repeated loading hotfix

## Root causes

1. **CORS middleware order.** The custom authentication middleware returned its own `401 JSONResponse` before the CORS middleware had a chance to add headers. Browsers therefore reported a misleading CORS failure for a stale or missing bearer token, even though the underlying API response was a normal authentication error.
2. **Unstable effect dependencies.** `loadProcess` depended on `team` and `roleGrades`. Workspace loading updated both state values, which recreated `loadProcess`, then recreated `loadWorkspace`. The `/api/auth/me` effect depended on `loadWorkspace`, so it repeatedly fetched the workspace. The collaboration WebSocket effect also depended on the team and grade arrays and repeatedly disconnected/reconnected.

## Fixes

- Register `CORSMiddleware` after the auth middleware so it is the outermost user middleware and decorates early auth responses too.
- Normalize allowed origins by trimming whitespace and trailing slashes. Keep an explicit origin allow-list; do not use `*` with credentials.
- Keep resource catalog state in refs (`teamRef`, `roleGradesRef`) for async callbacks.
- Make `loadProcess` stable and remove catalog arrays from the WebSocket effect dependencies. A socket now reconnects when the process/user changes or an explicit reconnect is scheduled, not when resource lists are refreshed.
- Display the invalid/expired session message on the login screen after clearing the stale token.

## Validation performed

- `python -m unittest discover -s tests -v`: 14 tests passed, including CORS headers on `/api/auth/me` 401, invalid login 401 and preflight `OPTIONS`.
- `python scripts/smoke_collaboration.py`: passed, including CORS checks, WebSocket snapshots/presence, ACK, peer broadcast, duplicate-operation retry and SQLite persistence.
- Frontend JSX syntax was parsed using the installed TypeScript transpiler.
- `npm install --no-audit --no-fund` timed out in this environment; the Vite production build has therefore not been verified here.

## Startup after applying the fix

Stop the currently running backend and frontend terminals with `Ctrl+C`, unpack this patched release over a clean project directory (preserve `backend/data/flowcost.sqlite3` if it contains your work), then start backend and frontend again using the README instructions. Existing browser tokens are not migrated or removed automatically; a stale token will now be cleared and shown as an expired session. Log in again with the account you registered. If `POST /api/auth/login` returns `401`, check the username/password or use registration only if you genuinely need a new account.
