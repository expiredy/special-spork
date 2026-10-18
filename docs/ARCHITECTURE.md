# FlowCost architecture (v0.5.3)

This note describes the source tree and the intended ownership of code. Keep business rules in `lib/` / `services/`, UI in focused components, and HTTP/WebSocket orchestration in the application layer.

## Browser URL map

| URL | View | Purpose |
|---|---|---|
| `/processes/:id` | Canvas | Main process editor; copy this link to share a process directly |
| `/processes/:id/activity` | Activity panel | Persisted and live process event journal |
| `/processes/:id/estimate` | Estimate panel | Cost breakdown without exporting Excel |
| `/processes/:id/settings` | Process settings | Financial-goal contribution settings |
| `/processes/:id/responsibility` | Responsibility lanes | Derived swimlane representation of task assignments |
| `/team` | Resource catalogue | Team members and role grades |
| `/team/tools` | Tools catalogue | Monthly subscriptions and licence costs |
| `/team/financial-goals` | Financial goals | Company reserves and monthly target tracking |
| `/team/online` | Online teammates | Presence, active process links, and access requests |

Routes are handled by `frontend/src/lib/routes.js`. Process links use `processPath()`, while resource views use `teamPath()`. Browser back/forward updates the selected view. The `Sidebar` copy-link action uses the process URL builder.

## Frontend modules

- `frontend/src/App.jsx` — application composition, process lifecycle, autosave, WebSocket connection lifecycle, keyboard shortcuts and page-level state. It should coordinate modules rather than contain all presentation markup.
- `frontend/src/components/ProcessNode.jsx` — React Flow node renderers and data-port presentation.
- `frontend/src/components/NodeEditor.jsx` — selected-node editing form.
- `frontend/src/components/Sidebar.jsx` — process list, folders, visibility, owner-only delete action, direct links and primary navigation.
- `frontend/src/components/CreateProcessModal.jsx` — process creation form and private/public visibility selection.
- `frontend/src/components/RemoteCursors.jsx` — renders remote pointers, converting shared graph coordinates into each collaborator’s local viewport.
- `frontend/src/components/ActivityPanel.jsx` — process change journal.
- `frontend/src/components/CostPreviewSidebar.jsx` — live estimate breakdown.
- `frontend/src/components/ResponsibilityView.jsx` — generated role-based lanes.
- `frontend/src/components/TeamPage.jsx` — resource catalogue screens.
- `frontend/src/components/OnlinePage.jsx` — live account presence, process navigation, incoming access requests, and approval actions.
- `frontend/src/components/AuthScreen.jsx`, `ShareModal.jsx`, `ProjectSettingsModal.jsx` — focused account/access/settings dialogs.
- `frontend/src/lib/api.js` — REST request helper and API base URL.
- `frontend/src/lib/routes.js` — URL parsing/generation for deep links.
- `frontend/src/lib/cursorCoordinates.js` — converts local screen coordinates to shared React Flow graph coordinates and back for each collaborator viewport.
- `frontend/src/lib/processModel.js` — graph normalization, node defaults, cost model and financial-goal calculations.
- `frontend/src/lib/collaborationProtocol.js` — stable-ID graph diff and operation application. This is the browser mirror of the backend operation protocol.
- `frontend/src/styles.css` — global UI styles. Component-specific style blocks should use namespaced class names.
- `frontend/tests/collaboration.test.mjs` — deterministic tests for normalized snapshots, node move/delete, routes, and cursor coordinate transforms.

### State flow for collaboration

1. REST loads a process and its resources.
2. Both the displayed graph and the collaboration baseline are normalized by the same rules. This is important: comparing a normalized canvas with raw stored data creates fake edits and can leave the status perpetually in `syncing`.
3. React Flow emits UI changes. The client debounces position updates and computes a stable-ID diff against the accepted baseline.
4. The WebSocket sends an operation batch with `op_id` and `base_revision`.
5. The server checks session, Origin, process permissions, message limits and revision conflicts. It commits the canonical graph, revision, receipt and event journal entry in one SQLite transaction.
6. The sender receives an ACK; other participants receive the same committed revision and its authoritative snapshot.
7. Each client rebases the incoming snapshot against local uncommitted changes, normalizes it using the same model, then updates the baseline. Remote revisions must not be marked as local edits.

The operation protocol is not a CRDT. Conflicting edits to the same field still follow the server's revision/conflict policy; see `COLLABORATION_MIGRATION.md` for the Yjs/CRDT next step.


## Account access and presence (v0.5.3)

- New accounts start with an empty process library. The startup migration removes the legacy starter process and deletes only unchanged generated copies. Process visibility is `private` by default or `public` for discoverable, read-only access to all registered users.
- A private process becomes shared when the owner grants `view`/`edit` access or approves an access request. Public visibility grants read-only access; write access still requires ownership or an `edit` share. A shared URL must resolve to the exact same `process_id` in each browser.
- `/api/presence/heartbeat` updates a per-user/per-tab row every 10 seconds. The online list expires entries after 45 seconds. A tab reports its process ID only when the user is actively in the canvas/editor view.
- `/api/presence/online` returns each active account and its current process sessions. For processes the viewer cannot access, the name is redacted as `Закрытый процесс`; an access request can be submitted without revealing the graph.
- `process_access_requests` stores pending/approved/rejected requests. Only a process owner can approve or reject. Approval creates a normal `process_shares` permission, so existing process REST/WS authorization remains the source of truth.
- Presence uses polling for the global online directory; process content and cursors continue to use WebSocket room connections. This keeps the global account list independent from the currently opened canvas while retaining per-process message authorization.
- Remote pointers are broadcast in graph/world coordinates. Each client applies its own viewport translation and zoom to render the cursor at the corresponding screen point, so different camera positions don't move the pointed-to graph location.
- Owners can delete their own processes from the sidebar. The backend enforces ownership and broadcasts `process_deleted` to open collaborators so stale editor tabs return to the library.

The app still uses one local SQLite DB and one backend process for its in-memory WebSocket rooms. Do not expose it directly to the public Internet without HTTPS/WSS, a trusted Origin allow-list, deployment-grade session controls, backups, and workspace isolation.

## Backend modules

- `backend/app/main.py` — FastAPI composition root, schema/migrations, auth/session primitives, process-access policy and dependency injection. New endpoint logic belongs in a router, not here.
- `backend/app/routers/auth.py` — registration, login, logout and current-session endpoints.
- `backend/app/routers/processes.py` — process CRUD, sharing permissions, event history and idempotency receipts.
- `backend/app/routers/resources.py` — team catalogue, role grades, tools and financial-goal endpoints.
- `backend/app/routers/collaboration.py` — WebSocket authentication, operation validation/orchestration, ACKs, room broadcasts, presence and cursor relay.
- `backend/app/services/rooms.py` — in-memory room registry for a single backend process. A shared pub/sub layer is required before running multiple workers.
- `backend/app/services/collaboration.py` — pure graph operations, stable path keys, validation helpers and conflict-path logic.
- `backend/app/services/collaboration_store.py` — SQLite transaction boundary for canonical snapshots, process revisions, idempotency receipts, path versions and event journal. The clock is injected explicitly as `now_iso_fn` to keep persistence deterministic/testable.
- `backend/app/services/costing.py` — pure graph-costing and financial goal calculation functions.
- `backend/app/services/export.py` — Excel workbook generator and export worksheet assembly.
- `backend/tests/test_costing.py` — unit/regression tests for cost, collaboration operations, workbook content and CORS.
- `frontend/tests/collaboration.test.mjs` — normalized baseline, node move/delete protocol and direct route tests.
- `scripts/smoke_collaboration.py` — black-box integration test using two separately registered users, a shared process, two WebSocket clients, cursor relay, node movement/deletion, ACKs, history and SQLite persistence.

### Source-code editing rule

For a cost formula, edit `services/costing.py` and its tests. For a collaboration operation rule, edit `services/collaboration.py`, `frontend/src/lib/collaborationProtocol.js`, and the relevant collaboration tests. For workbook columns or formatting, edit `services/export.py`. For a screen, edit its component under `frontend/src/components/`. Keep `App.jsx` as the coordinator and add new page-level views as separate components/routes.

## Storage and deployment notes

- SQLite file: `backend/data/flowcost.sqlite3` by default; override with `FLOWCOST_DB_PATH`.
- Auth and WebSocket Origin checks are server-enforced; browser-side hiding is not authorization.
- One Uvicorn worker is required for the current in-memory WebSocket rooms/presence manager. For multiple processes/hosts, replace in-memory broadcast with shared pub/sub and move to a storage setup designed for multi-writer collaboration.
- Back up the SQLite database and test restore before internal production use.

## Debugging collaboration

1. Confirm both browser sessions use the same API base URL (`VITE_API_URL`) and process ID. On separate computers, `localhost` points to different computers; use one shared backend hostname/IP instead.
2. The online count on a process reports WebSocket connections in that one backend process. If the second account is not reflected, verify that the process owner shared edit/view access with that account.
3. An operation gets a server ACK only after the SQLite transaction commits. The `process_events` journal records committed operations; `/api/processes/:id/history` can be used to verify that changes made it to the server.
4. Run `python scripts/smoke_collaboration.py` to reproduce the two-account test without a browser. The script covers cursor relay, move, delete, ACKs and durable persistence.
5. The UI now detects an operation with no ACK after 8 seconds, reconnects and compares the server snapshot/receipt so the orange status cannot persist silently forever. Backend exceptions are logged and sent back as a WebSocket error before the connection closes where possible.
