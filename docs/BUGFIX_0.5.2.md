# FlowCost 0.5.2 — cross-account collaboration fix

## Root causes

1. `AuthScreen.jsx` used `useState` and `useEffect` without importing those named React hooks. The same hook-import bug was present in `ShareModal.jsx` and `ProjectSettingsModal.jsx`, so registration/login, sharing, or process-settings screens could fail at runtime. These imports are fixed.
2. Registering a new account deliberately creates a private copy of the starter process. Different accounts therefore started from separate `process_id` values and had separate journals; same account in two browsers happened to point to one process/session. This was easy to misread because every copy had the same title. New copies are now named `Моя копия: …` in `Мои процессы`. Existing copies are not auto-merged/renamed.
3. `loadWorkspace()` silently fell back to the first personal process when a direct URL referred to a process not present in the current account's list. This made inaccessible deep links appear to open another local process. It now displays an explicit access-required view and keeps the target process ID instead of silently switching.

## Implemented

- Fixed missing React hook imports in auth, share and project settings dialogs.
- Added the online directory at `/team/online`, backed by authenticated heartbeat records per browser tab. The frontend sends a heartbeat every 10 seconds and the server expires stale presence after 45 seconds; UI refreshes every 5 seconds.
- Added `POST /api/presence/heartbeat` and `GET /api/presence/online`. Process names are redacted to `Закрытый процесс` for viewers without access. The user can still request access with the private process id, but cannot read the graph until permission is approved.
- Added process access requests: request, list incoming requests, owner approval (`edit` or `view`) and rejection. Approval creates a normal `process_shares` row so the same backend checks guard REST, history and WebSocket.
- Added online page actions to open the same shared process, request access, or grant/reject requests.
- Added a specific direct-link error page so a 403 cannot masquerade as the user's personal copy.
- Updated route tests, access documentation, and real two-account WebSocket smoke test.

## Validation

- Backend unit tests: 14 passed.
- Frontend model/route tests: 4 passed.
- JSX/JavaScript syntax transpilation: 17 frontend source files passed.
- Collaboration smoke test: passed registration, private-process isolation, hidden metadata for inaccessible processes, access request/approval, online presence, WebSocket cursors across two different users, movement, deletion, journal and SQLite persistence.
- Full Vite production build could not be run because `npm install --no-audit --no-fund` timed out in this environment.

## How to use cross-account collaboration

The owner shares a process through the process menu, or the colleague requests access on `/team/online`. After the owner grants access, both accounts must open the same `/processes/<process_id>` URL. Two personal copies with matching titles are still independent graphs.

This version still targets one local backend process and one SQLite database. Presence uses polling rather than a global presence WebSocket; WebSocket collaboration for process content/cursors remains process-scoped. Use HTTPS/WSS and deployment security hardening before exposing the app beyond a trusted internal network.
