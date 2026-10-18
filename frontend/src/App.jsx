import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap, addEdge, applyEdgeChanges, applyNodeChanges,
  BackgroundVariant, SelectionMode,
} from '@xyflow/react';
import {
  Activity, ArrowDownToLine, Blocks, CircleDollarSign, Copy, FileJson, FileSpreadsheet,
  Link2, GitBranch, Plus, Save, Settings2, Workflow, X, Upload, StickyNote, ShieldAlert,
  Keyboard, Menu, Eye, EyeOff, Calculator, FolderOpen, UserRound, UsersRound, ChevronDown,
  LogOut, LayoutGrid, ListTree, CircleHelp, Share2,
} from 'lucide-react';
import ActivityPanel from './components/ActivityPanel.jsx';
import { ProcessNode, nodePortData, nodeTypes } from './components/ProcessNode.jsx';
import { Sidebar } from './components/Sidebar.jsx';
import { NodeEditor } from './components/NodeEditor.jsx';
import { AuthScreen } from './components/AuthScreen.jsx';
import { AdminRegistrationsPage } from './components/AdminRegistrationsPage.jsx';
import { ShareModal } from './components/ShareModal.jsx';
import { OnlinePage } from './components/OnlinePage.jsx';
import { TeamPage } from './components/TeamPage.jsx';
import { ProjectSettingsModal } from './components/ProjectSettingsModal.jsx';
import { CostPreviewSidebar } from './components/CostPreviewSidebar.jsx';
import { ResponsibilityView } from './components/ResponsibilityView.jsx';
import { CreateProcessModal } from './components/CreateProcessModal.jsx';
import { RemoteCursors } from './components/RemoteCursors.jsx';
import { API, api } from './lib/api.js';
import { readRoute, processPath, teamPath } from './lib/routes.js';
import * as Model from './lib/processModel.js';
import { stateFromParts, diffCollaborativeState, applyOperationsToState } from './lib/collaborationProtocol.js';
import { screenToFlowPoint } from './lib/cursorCoordinates.js';
const {
  RUB, HOURS, makeId, newPort, normalizePortList, isDataFlowEdge,
  defaultGradeForRole, normalizeProcessEdges, normalizeProcessNodes, newNode,
  getNodeCost, calculateLocal, applyFinancialGoalsLocal,
} = Model;

export default function App() {
  const [processes, setProcesses] = useState([]);
  const [team, setTeam] = useState([]);
  const [tools, setTools] = useState([]);
  const [roleGrades, setRoleGrades] = useState([]);
  const [financialGoals, setFinancialGoals] = useState([]);
  const [processSettings, setProcessSettings] = useState({ financial_goal_allocations: [] });
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const [collabStatus, setCollabStatus] = useState('offline');
  const [reconnectTick, setReconnectTick] = useState(0);
  const [syncTick, setSyncTick] = useState(0);
  const [user, setUser] = useState(() => { try { return JSON.parse(localStorage.getItem('flowcost_user') || 'null'); } catch { return null; } });
  const [activeProcessId, setActiveProcessId] = useState(null);
  const [currentProcess, setCurrentProcess] = useState(null);
  const [processName, setProcessName] = useState('');
  const [processDescription, setProcessDescription] = useState('');
  const [processFolder, setProcessFolder] = useState('');
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [page, setPage] = useState(() => readRoute().page);
  const [teamTab, setTeamTab] = useState(() => readRoute().teamTab || 'team');
  const [accessDeniedProcessId, setAccessDeniedProcessId] = useState(null);
  const [accessDeniedReason, setAccessDeniedReason] = useState('');
  const [accessRequestBusy, setAccessRequestBusy] = useState(false);
  const [accessRequestSent, setAccessRequestSent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [libraryChoice, setLibraryChoice] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showHints, setShowHints] = useState(() => localStorage.getItem('flowcost_show_hints') !== 'false');
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [costPreviewOpen, setCostPreviewOpen] = useState(false);
  const [viewMode, setViewMode] = useState('canvas');
  const [sortOrder, setSortOrder] = useState('updated');
  const [shareOpen, setShareOpen] = useState(false);
  const [presence, setPresence] = useState(1);
  const [remoteCursors, setRemoteCursors] = useState({});
  const [canvasViewport, setCanvasViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const [createProcessOpen, setCreateProcessOpen] = useState(false);
  const [creatingProcess, setCreatingProcess] = useState(false);
  const [activityOpen, setActivityOpen] = useState(() => readRoute().activityOpen);
  const [activityEvents, setActivityEvents] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const fileRef = useRef(null);
  const nameRef = useRef(null);
  const descriptionRef = useRef(null);
  const folderRef = useRef(null);
  const canvasWrapRef = useRef(null);
  const canvasViewportRef = useRef({ x: 0, y: 0, zoom: 1 });
  const socketRef = useRef(null);
  const nodesRef = useRef([]);
  const edgesRef = useRef([]);
  const teamRef = useRef(team);
  const roleGradesRef = useRef(roleGrades);
  teamRef.current = team;
  roleGradesRef.current = roleGrades;
  const currentStateRef = useRef(null);
  const baseSnapshotRef = useRef(null);
  const revisionRef = useRef(1);
  const pendingBatchRef = useRef(null);
  const pendingBatchTimerRef = useRef(null);
  const inboundOpsRef = useRef(new Map());
  const collaborationJoinedRef = useRef(false);
  const collaborationSnapshotReceivedRef = useRef(false);
  const requestedBaseRevisionRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const reconnectAttemptRef = useRef(0);
  const resyncingRef = useRef(false);
  const queuedSnapshotRef = useRef(null);
  const socketGenerationRef = useRef(0);
  const localClientIdRef = useRef(makeId('client'));
  const presenceClientIdRef = useRef(null);
  if (!presenceClientIdRef.current) {
    let storedClientId = sessionStorage.getItem('flowcost_presence_client_id');
    if (!storedClientId) { storedClientId = makeId('presence'); sessionStorage.setItem('flowcost_presence_client_id', storedClientId); }
    presenceClientIdRef.current = storedClientId;
  }
  const applyingRemoteRef = useRef(false);
  const historyRef = useRef({ entries: [], lastAt: 0 });
  const lastCursorBroadcastRef = useRef(0);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const editRevisionRef = useRef(0);
  const localUsernameRef = useRef('');

  const pushActivityEvent = useCallback((event) => {
    const operations = Array.isArray(event?.operations) ? event.operations : [];
    const first = operations[0] || {};
    const type = String(first.type || 'change');
    let action = 'обновил процесс';
    if (operations.length === 1 && type === 'node.add') action = `добавил блок «${first.node?.data?.name || first.node?.type || 'Новый блок'}»`;
    else if (operations.length === 1 && type === 'node.remove') action = 'удалил блок';
    else if (operations.some((operation) => operation.type === 'node.remove')) action = `удалил элементы (${operations.length} операций)`;
    else if (operations.some((operation) => operation.type === 'set' && operation.entity === 'node' && operation.path?.[0] === 'position')) action = 'переместил блок';
    else if (operations.some((operation) => operation.type?.startsWith('edge.'))) action = 'изменил связи процесса';
    else if (operations.some((operation) => operation.type === 'node.add')) action = `добавил блоки (${operations.length} операций)`;
    else if (first.type === 'snapshot.replace') action = 'сохранил полную версию процесса';
    else if (operations.some((operation) => operation.type === 'set' && operation.entity === 'node' && operation.path?.includes('name'))) action = 'изменил название блока';
    const entry = {
      revision: Number(event.revision) || null,
      username: event.user || event.username || user?.username || 'Участник',
      created_at: event.created_at || event.updated_at || new Date().toISOString(),
      operations,
      conflicts: event.conflicts || [],
      action,
      op_id: event.op_id || null,
    };
    setActivityEvents((current) => {
      const key = entry.revision ? `r:${entry.revision}` : entry.op_id ? `o:${entry.op_id}` : `t:${entry.created_at}:${entry.username}`;
      const merged = new Map();
      for (const item of [...current, entry]) {
        const itemKey = item.revision ? `r:${item.revision}` : item.op_id ? `o:${item.op_id}` : `t:${item.created_at}:${item.username}`;
        merged.set(itemKey, item);
      }
      return [...merged.values()].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 150);
    });
  }, [user?.username]);

  const loadProcess = useCallback(async (processId, resourceContext = null) => {
    if (!processId) return;
    const process = await api(`/api/processes/${processId}`);
    const activeTeam = resourceContext?.team || teamRef.current;
    const activeGrades = resourceContext?.roleGrades || roleGradesRef.current;
    const rawNodes = process.nodes || [];
    const nodesForUI = normalizeProcessNodes(rawNodes, activeTeam, activeGrades);
    const edgesForUI = normalizeProcessEdges(process.edges || []);
    const settings = process.settings || { financial_goal_allocations: [] };
    // Keep the editor baseline in the exact same normalized representation as the canvas.
    // Comparing normalized React Flow nodes to raw DB nodes creates a permanent dirty state
    // (default grades, legacy edge handles/classes), which can cause repeated writes and
    // prevents the sync indicator from ever reaching "online".
    const localInitial = stateFromParts({ nodes: nodesForUI, edges: edgesForUI, settings, name: process.name, description: process.description, folder: process.folder });
    setActiveProcessId(process.id); setCurrentProcess(process); setAccessDeniedProcessId(null); setAccessDeniedReason(''); setAccessRequestSent(false);
    setProcessName(process.name || ''); setProcessDescription(process.description || ''); setProcessFolder(process.folder || ''); setProcessSettings(settings);
    setNodes(nodesForUI); setEdges(edgesForUI);
    baseSnapshotRef.current = localInitial;
    currentStateRef.current = localInitial;
    revisionRef.current = Number(process.revision) || 1;
    requestedBaseRevisionRef.current = revisionRef.current;
    pendingBatchRef.current = null;
    if (pendingBatchTimerRef.current) clearTimeout(pendingBatchTimerRef.current);
    pendingBatchTimerRef.current = null;
    inboundOpsRef.current = new Map(); collaborationJoinedRef.current = false; collaborationSnapshotReceivedRef.current = false;
    setCollabStatus('connecting');
    setSelectedNodeId(null); setRemoteCursors({}); setDirty(false); setError(''); setPage('canvas'); setMenuOpen(false); setProjectSettingsOpen(false); setActivityOpen(false); setCostPreviewOpen(false); setViewMode('canvas');
    historyRef.current = { entries: [], lastAt: 0 };
    editRevisionRef.current = 0;
  }, []);

  const reloadTeam = useCallback(async () => { setTeam(await api('/api/team')); }, []);
  const reloadTools = useCallback(async () => { setTools(await api('/api/tools')); }, []);
  const reloadRoleGrades = useCallback(async () => { setRoleGrades(await api('/api/roles/grades')); }, []);
  const reloadFinancialGoals = useCallback(async () => { setFinancialGoals(await api('/api/financial-goals')); }, []);

  const loadWorkspace = useCallback(async () => {
    const route = readRoute();
    const [list, members, storedTools, grades, goals] = await Promise.all([api('/api/processes'), api('/api/team'), api('/api/tools'), api('/api/roles/grades'), api('/api/financial-goals')]);
    setProcesses(list); setTeam(members); setTools(storedTools); setRoleGrades(grades); setFinancialGoals(goals); setTeamTab(route.teamTab || 'team');
    const requestedProcess = route.processId ? list.find((item) => item.id === route.processId) : null;
    // A deep link must never silently fall back to the current user's private demo copy.
    // That behaviour made two similar-looking but independent processes appear to be one.
    const selected = route.processId ? (requestedProcess || { id: route.processId }) : list[0];
    if (selected?.id) {
      try {
        await loadProcess(selected.id, { team: members, roleGrades: grades });
      } catch (err) {
        if (!route.processId) throw err;
        setActiveProcessId(null); setCurrentProcess(null); setNodes([]); setEdges([]);
        setPage('access'); setTeamTab('online'); setAccessDeniedProcessId(route.processId);
        setAccessDeniedReason(err.message || 'Нет доступа к этому процессу.');
        setAccessRequestSent(false); setActivityOpen(false); setCostPreviewOpen(false); setProjectSettingsOpen(false); setViewMode('canvas');
        setLoading(false);
        return;
      }
      const subview = route.processId && route.page !== 'team' ? route.subview : 'canvas';
      const destination = route.page === 'team' ? teamPath(route.teamTab) : processPath(selected.id, subview);
      if (window.location.pathname !== destination) window.history.replaceState({}, '', destination);
      setPage(route.page === 'team' ? 'team' : 'canvas'); setTeamTab(route.teamTab || 'team');
      setActivityOpen(route.page !== 'team' && subview === 'activity');
      setCostPreviewOpen(route.page !== 'team' && subview === 'estimate');
      setProjectSettingsOpen(route.page !== 'team' && subview === 'settings');
      setViewMode(route.page !== 'team' && subview === 'responsibility' ? 'responsibility' : 'canvas');
    } else {
      setPage(route.page); setTeamTab(route.teamTab || 'team');
      setActivityOpen(false); setCostPreviewOpen(false); setProjectSettingsOpen(false); setViewMode('canvas');
    }
    setLoading(false);
  }, [loadProcess]);

  const handleAuthenticated = async (authenticatedUser) => {
    setError('');
    setLoading(true);
    setUser(authenticatedUser);
    localStorage.setItem('flowcost_user', JSON.stringify(authenticatedUser));
    try { await loadWorkspace(); } catch (err) { setError(`Не удалось открыть пространство: ${err.message}`); setLoading(false); }
  };

  useEffect(() => {
    // A verification link must be processed by AuthScreen even if this browser
    // still has a different account's valid session stored locally.
    const url = new URL(window.location.href);
    if (url.searchParams.has('verify_email')) { setLoading(false); return; }
    const token = localStorage.getItem('flowcost_token');
    if (!token) { setLoading(false); return; }
    (async () => {
      try {
        const actualUser = await api('/api/auth/me');
        setUser(actualUser); localStorage.setItem('flowcost_user', JSON.stringify(actualUser));
        await loadWorkspace();
      } catch (err) {
        localStorage.removeItem('flowcost_token'); localStorage.removeItem('flowcost_user'); setUser(null);
        setError(err.message.includes('Сессия') ? 'Сессия истекла или токен браузера недействителен. Войдите снова.' : `Не удалось подключиться к API: ${err.message}`); setLoading(false);
      }
    })();
  }, [loadWorkspace]);

  useEffect(() => {
    if (!user?.id) return undefined;
    const sendHeartbeat = () => {
      const editingProcessId = page === 'canvas' && currentProcess?.id ? activeProcessId : null;
      api('/api/presence/heartbeat', {
        method: 'POST',
        body: JSON.stringify({
          client_id: presenceClientIdRef.current,
          process_id: editingProcessId,
          route: window.location.pathname,
        }),
      }).catch(() => {});
    };
    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, 10000);
    return () => clearInterval(interval);
  }, [user?.id, page, teamTab, activeProcessId, currentProcess?.id]);

  useEffect(() => {
    const applySubview = (subview) => {
      setActivityOpen(subview === 'activity');
      setCostPreviewOpen(subview === 'estimate');
      setProjectSettingsOpen(subview === 'settings');
      setViewMode(subview === 'responsibility' ? 'responsibility' : 'canvas');
    };
    const handleRouteChange = () => {
      const route = readRoute();
      setMenuOpen(false);
      if (route.page === 'team') {
        setPage('team'); setTeamTab(route.teamTab || 'team'); applySubview('canvas');
        return;
      }
      setPage('canvas'); applySubview(route.subview);
      if (route.processId && route.processId !== activeProcessId) {
        loadProcess(route.processId).then(() => applySubview(route.subview)).catch((err) => {
          setCurrentProcess(null); setActiveProcessId(null); setNodes([]); setEdges([]);
          setAccessDeniedProcessId(route.processId); setAccessDeniedReason(err.message || 'Нет доступа к процессу.');
          setAccessRequestSent(false); setPage('access'); setError('');
        });
      }
    };
    window.addEventListener('popstate', handleRouteChange);
    return () => window.removeEventListener('popstate', handleRouteChange);
  }, [activeProcessId, loadProcess]);

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);

  const recordHistory = useCallback(() => {
    if (applyingRemoteRef.current) return;
    // Graph data is JSON-serializable; deep-copy nested assignments, ports, and custom fields so
    // a later edit cannot mutate a prior undo snapshot through a shared nested reference.
    const snapshot = JSON.parse(JSON.stringify(currentStateRef.current || stateFromParts({
      nodes: nodesRef.current, edges: edgesRef.current, settings: processSettings,
      name: processName, description: processDescription, folder: processFolder,
    })));
    const previous = historyRef.current.entries[historyRef.current.entries.length - 1];
    // React Flow may report deletion of a node and its edges as two callbacks. Don't add
    // duplicate snapshots for that single user action.
    if (previous && JSON.stringify(previous) === JSON.stringify(snapshot)) return;
    historyRef.current.entries.push(snapshot);
    if (historyRef.current.entries.length > 80) historyRef.current.entries.shift();
  }, []);

  useEffect(() => { if (!toast) return undefined; const timer = setTimeout(() => setToast(''), 3200); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target;
      const editing = target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveProcess(true); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !editing && canEdit) { event.preventDefault(); undoLastAction(); return; }
      if (event.key === '?' && !editing) { setShortcutsOpen(true); return; }
      if (event.key === 'Escape') { setMenuOpen(false); setShortcutsOpen(false); setShareOpen(false); return; }
      if (editing || page !== 'canvas' || !canEdit) return;
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'g') {
        if (selectedNode?.type === 'group') { event.preventDefault(); ungroupNode(selectedNode.id); }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'g') { event.preventDefault(); groupSelectedNodes(); return; }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'n') { event.preventDefault(); addStep('task'); }
      if (key === 's') { event.preventDefault(); addStep('sticker'); }
      if (key === 'r') { event.preventDefault(); addStep('risk'); }
      if (key === 'g') { event.preventDefault(); addGroupShape(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || null;
  const flowNodes = useMemo(() => nodePortData(nodes, edges), [nodes, edges]);
  const baseSummary = useMemo(() => calculateLocal(nodes, edges, team, tools, roleGrades), [nodes, edges, team, tools, roleGrades]);
  const summary = useMemo(() => applyFinancialGoalsLocal(baseSummary, processSettings, financialGoals), [baseSummary, processSettings, financialGoals]);
  const currency = roleGrades[0]?.currency || tools[0]?.currency || 'RUB';
  const multiCurrency = new Set([...tools.filter((tool) => tool.active).map((tool) => tool.currency), ...roleGrades.map((grade) => grade.currency)]).size > 1;
  const currentSyncState = stateFromParts({ nodes, edges, settings: processSettings, name: processName, description: processDescription, folder: processFolder });
  currentStateRef.current = currentSyncState;
  const sortedProcesses = useMemo(() => [...processes].sort((a, b) => sortOrder === 'name' ? a.name.localeCompare(b.name, 'ru') : sortOrder === 'folder' ? `${a.folder || 'Без папки'}${a.name}`.localeCompare(`${b.folder || 'Без папки'}${b.name}`, 'ru') : (b.updated_at || '').localeCompare(a.updated_at || '')), [processes, sortOrder]);
  const canEdit = currentProcess?.can_edit !== false;

  const markDirty = useCallback(() => { editRevisionRef.current += 1; setDirty(true); }, []);
  const onNodesChange = useCallback((changes) => {
    // Position changes are grouped into one undo action through React Flow's drag-start event.
    if (changes.some((change) => ['remove', 'add', 'replace'].includes(change.type))) recordHistory();
    const removedIds = new Set(changes.filter((change) => change.type === 'remove').map((change) => change.id));
    setNodes((items) => {
      const removedGroups = items.filter((node) => removedIds.has(node.id) && node.type === 'group');
      let next = applyNodeChanges(changes, items);
      for (const group of removedGroups) {
        const children = items.filter((node) => node.parentId === group.id && !removedIds.has(node.id)).map((node) => ({ ...node, parentId: undefined, extent: undefined, position: { x: group.position.x + node.position.x, y: group.position.y + node.position.y } }));
        next = next.filter((node) => node.id !== group.id && node.parentId !== group.id);
        next.push(...children);
      }
      return next;
    });
    if (removedIds.size) setSelectedNodeId((current) => removedIds.has(current) ? null : current);
    if (changes.some((change) => ['position', 'remove', 'add', 'replace'].includes(change.type))) markDirty();
  }, [recordHistory, markDirty]);
  const onEdgesChange = useCallback((changes) => {
    if (changes.some((change) => ['remove', 'add', 'replace'].includes(change.type))) recordHistory();
    setEdges((items) => applyEdgeChanges(changes, items));
    if (changes.some((change) => ['remove', 'add', 'replace'].includes(change.type))) markDirty();
  }, [recordHistory, markDirty]);
  const onConnect = useCallback((connection) => {
    recordHistory();
    const dataFlow = String(connection.sourceHandle || '').startsWith('out-') && String(connection.targetHandle || '').startsWith('in-');
    if (dataFlow && edges.some((edge) => isDataFlowEdge(edge) && edge.target === connection.target && edge.targetHandle === connection.targetHandle)) {
      setError('У этого входа уже есть источник. Сначала разорвите текущую связь.');
      return;
    }
    const next = { ...connection, id: makeId('edge'), type: 'smoothstep', dataFlow, className: dataFlow ? 'data-flow-edge' : 'process-flow-edge' };
    setEdges((items) => addEdge(next, items)); markDirty();
  }, [edges, recordHistory, markDirty]);
  const patchNodeData = (nextData) => { recordHistory(); setNodes((items) => items.map((node) => node.id === selectedNodeId ? { ...node, data: nextData } : node)); markDirty(); };
  const patchAssignmentForNode = (nodeId, index, patch) => {
    recordHistory();
    setNodes((items) => items.map((node) => {
      if (node.id !== nodeId) return node;
      const assignments = [...(node.data.assignments || [])];
      assignments[index] = { ...assignments[index], ...patch };
      return { ...node, data: { ...node.data, assignments } };
    }));
    markDirty();
  };
  const patchAssignment = (index, patch) => {
    if (!selectedNode) return;
    const assignments = [...(selectedNode.data.assignments || [])]; assignments[index] = { ...assignments[index], ...patch };
    patchNodeData({ ...selectedNode.data, assignments });
  };
  const addAssignment = () => {
    if (!selectedNode) return;
    const first = team.find((member) => member.active);
    patchNodeData({ ...selectedNode.data, assignments: [...(selectedNode.data.assignments || []), { id: makeId('work'), task: `Новая задача ${(selectedNode.data.assignments || []).length + 1}`, goal: '', expected_result: '', tags: [], custom_fields: [], member_id: first?.id || '', role: first?.role || '', name: first?.name || '', grade_id: defaultGradeForRole(first?.role, roleGrades)?.id || '', hours: 1 }] });
  };
  const removeAssignment = (index) => patchNodeData({ ...selectedNode.data, assignments: (selectedNode.data.assignments || []).filter((_, i) => i !== index) });
  const patchEdge = (edgeId, label) => { recordHistory(); setEdges((items) => items.map((edge) => edge.id === edgeId ? { ...edge, label } : edge)); markDirty(); };
  const patchPort = (field, portId, label) => {
    if (!selectedNode) return;
    const ports = normalizePortList(selectedNode.data?.[field], selectedNode.id, field === 'inputs' ? 'input' : 'output');
    patchNodeData({ ...selectedNode.data, [field]: ports.map((port) => port.id === portId ? { ...port, label } : port) });
  };
  const addPort = (field) => {
    if (!selectedNode) return;
    const ports = normalizePortList(selectedNode.data?.[field], selectedNode.id, field === 'inputs' ? 'input' : 'output');
    patchNodeData({ ...selectedNode.data, [field]: [...ports, newPort('')] });
  };
  const removePort = (field, portId) => {
    if (!selectedNode) return;
    const handleId = `${field === 'outputs' ? 'out' : 'in'}-${portId}`;
    const ports = normalizePortList(selectedNode.data?.[field], selectedNode.id, field === 'inputs' ? 'input' : 'output').filter((port) => port.id !== portId);
    patchNodeData({ ...selectedNode.data, [field]: ports });
    setEdges((items) => items.filter((edge) => !((edge.source === selectedNode.id && edge.sourceHandle === handleId) || (edge.target === selectedNode.id && edge.targetHandle === handleId))));
  };
  const removeConnection = (edgeId) => { recordHistory(); setEdges((items) => items.filter((edge) => edge.id !== edgeId)); markDirty(); };

  const undoLastAction = () => {
    const previous = historyRef.current.entries.pop();
    if (!previous) { setToast('Нет действий для отмены в этой сессии'); return; }
    applyingRemoteRef.current = true;
    setNodes(previous.nodes); setEdges(previous.edges); setProcessSettings(previous.settings || { financial_goal_allocations: [] });
    setProcessName(previous.name || 'Новый процесс'); setProcessDescription(previous.description || ''); setProcessFolder(previous.folder || '');
    markDirty();
    setTimeout(() => { applyingRemoteRef.current = false; }, 100);
    setToast('Последнее действие отменено');
  };

  const saveProcess = async (manual = false) => {
    if (!currentProcess || !dirty || currentProcess.can_edit === false) {
      if (manual && currentProcess && !dirty) setToast('Все изменения уже сохранены');
      return;
    }
    if (collabStatus !== 'error' && collaborationJoinedRef.current && collaborationSnapshotReceivedRef.current && socketRef.current?.readyState === WebSocket.OPEN) {
      if (manual) setToast('Изменения отправляются коллегам в реальном времени');
      setSyncTick((value) => value + 1);
      return;
    }
    if (collabStatus === 'conflict') return;
    const savedRevision = editRevisionRef.current;
    const localAtSave = stateFromParts({ nodes, edges, settings: processSettings, name: processName, description: processDescription, folder: processFolder });
    const payload = {
      name: processName || 'Новый процесс', description: processDescription, folder: processFolder,
      settings: processSettings, nodes, edges, expected_revision: revisionRef.current,
    };
    setSaving(true); setError('');
    try {
      const updated = await api(`/api/processes/${currentProcess.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      const persisted = stateFromParts({ nodes: updated.nodes || nodes, edges: normalizeProcessEdges(updated.edges || edges), settings: updated.settings || processSettings, name: updated.name, description: updated.description, folder: updated.folder });
      baseSnapshotRef.current = persisted;
      revisionRef.current = Number(updated.revision) || revisionRef.current + 1;
      requestedBaseRevisionRef.current = revisionRef.current;
      setCurrentProcess((previous) => ({ ...updated, can_edit: previous?.can_edit !== false }));
      const list = await api('/api/processes'); setProcesses(list);
      const current = currentStateRef.current || localAtSave;
      const stillDirty = JSON.stringify(current) !== JSON.stringify(persisted);
      setDirty(stillDirty);
      if (editRevisionRef.current === savedRevision && !stillDirty) {
        setCollabStatus('offline');
        if (manual) setToast('Изменения сохранены');
      } else {
        markDirty();
      }
      setSyncTick((value) => value + 1);
    } catch (err) {
      setError(err.message);
      if (/уже изменён|обновите состояние|409/i.test(err.message)) {
        setCollabStatus('conflict');
        setToast('Версия процесса изменилась. Не перезаписываем чужие изменения; дождитесь восстановления синхронизации.');
      }
    } finally { setSaving(false); }
  };

  useEffect(() => {
    if (!dirty || saving || !currentProcess || currentProcess.can_edit === false || !user || collabStatus === 'conflict') return undefined;
    // While a socket is authenticating or syncing its first snapshot, wait rather than racing it with a full-document REST write.
    if (collabStatus === 'connecting' || collabStatus === 'syncing') return undefined;
    const timer = setTimeout(() => { saveProcess(false); }, 950);
    return () => clearTimeout(timer);
  }, [dirty, saving, collabStatus, currentProcess?.id, currentProcess?.can_edit, nodes, edges, processSettings, processName, processDescription, processFolder, user?.id]);

  useEffect(() => {
    if (page === 'team' || !activeProcessId || !user?.id) {
      collaborationJoinedRef.current = false;
      collaborationSnapshotReceivedRef.current = false;
      setCollabStatus('offline');
      return undefined;
    }
    const token = localStorage.getItem('flowcost_token');
    if (!token) return undefined;
    let disposed = false;
    const generation = ++socketGenerationRef.current;
    const wsUrl = API.replace(/^http/i, 'ws') + `/api/ws/process/${encodeURIComponent(activeProcessId)}`;
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;
    collaborationJoinedRef.current = false;
    collaborationSnapshotReceivedRef.current = false;
    setCollabStatus('connecting');

    const normalizeStateForUI = (state) => stateFromParts({
      nodes: normalizeProcessNodes(state.nodes || [], teamRef.current, roleGradesRef.current),
      edges: normalizeProcessEdges(state.edges || []),
      settings: state.settings || { financial_goal_allocations: [] },
      name: state.name, description: state.description, folder: state.folder,
    });
    const installState = (state, baseline, updateDirty = true) => {
      const uiState = normalizeStateForUI(state);
      currentStateRef.current = uiState;
      setNodes(uiState.nodes); setEdges(uiState.edges); setProcessSettings(uiState.settings);
      setProcessName(uiState.name); setProcessDescription(uiState.description); setProcessFolder(uiState.folder);
      if (updateDirty) setDirty(JSON.stringify(uiState) !== JSON.stringify(baseline));
      return uiState;
    };
    const snapshotState = (message) => {
      const source = message.process || message;
      // Normalize the authoritative server snapshot exactly as we normalize the canvas.
      // The baseline and visible state must share the same representation, otherwise each
      // rebase sees artificial changes that were only introduced by the UI normalizer.
      return normalizeStateForUI({
        nodes: source.nodes || [], edges: source.edges || [],
        settings: source.settings || { financial_goal_allocations: [] },
        name: source.name || 'Новый процесс', description: source.description || '', folder: source.folder || '',
      });
    };
    const updateProcessMeta = (state, revision, canEditValue) => {
      setCurrentProcess((previous) => previous ? {
        ...previous, name: state.name, description: state.description, folder: state.folder,
        revision, can_edit: canEditValue ?? previous.can_edit,
      } : previous);
    };

    const rebaseSnapshot = async (message) => {
      if (disposed) return;
      if (resyncingRef.current) {
        const incomingRevision = Number((message.process || message).revision) || 0;
        const queuedRevision = Number(((queuedSnapshotRef.current || {}).process || queuedSnapshotRef.current || {}).revision) || 0;
        if (!queuedSnapshotRef.current || incomingRevision >= queuedRevision) queuedSnapshotRef.current = message;
        return;
      }
      resyncingRef.current = true;
      try {
        const oldBase = baseSnapshotRef.current;
        const oldCurrent = currentStateRef.current || oldBase;
        const oldPending = pendingBatchRef.current;
        const oldRevision = revisionRef.current;
        let alreadyCommitted = false;
        if (oldPending?.op_id) {
          try {
            const receipt = await api(`/api/processes/${activeProcessId}/ops/${encodeURIComponent(oldPending.op_id)}`);
            alreadyCommitted = Boolean(receipt.committed);
          } catch { /* no receipt means this batch was not committed or the server is still reconnecting */ }
        }
        const preserveBase = oldBase && oldPending && alreadyCommitted
          ? applyOperationsToState(oldBase, oldPending.operations)
          : oldBase;
        const localOperations = preserveBase && oldCurrent ? diffCollaborativeState(preserveBase, oldCurrent) : [];
        const latestBase = snapshotState(message);
        const merged = localOperations.length ? applyOperationsToState(latestBase, localOperations) : latestBase;
        const latestRevision = Number((message.process || message).revision) || oldRevision;
        baseSnapshotRef.current = latestBase;
        revisionRef.current = latestRevision;
        pendingBatchRef.current = null;
        if (pendingBatchTimerRef.current) clearTimeout(pendingBatchTimerRef.current);
        pendingBatchTimerRef.current = null;
        inboundOpsRef.current.clear();
        collaborationSnapshotReceivedRef.current = true;
        collaborationJoinedRef.current = socket.readyState === WebSocket.OPEN;
        // Once local edits have been rebased onto the canonical snapshot, subsequent writes
        // must be based on that snapshot's revision, not on the stale revision from before.
        requestedBaseRevisionRef.current = latestRevision;
        const uiState = installState(merged, latestBase);
        const canEditValue = message.can_edit ?? message.process?.can_edit;
        updateProcessMeta(latestBase, latestRevision, canEditValue);
        setCollabStatus(JSON.stringify(uiState) === JSON.stringify(latestBase) ? 'online' : 'syncing');
        setError((currentError) => currentError.startsWith('Сервер не подтвердил изменение за 8 секунд.') ? '' : currentError);
        setSyncTick((value) => value + 1);
        if (localOperations.length && JSON.stringify(uiState) !== JSON.stringify(latestBase)) {
          setToast(alreadyCommitted ? 'Восстановили локальные правки после переподключения' : 'Подключение восстановлено: локальные изменения объединены с актуальной версией');
        }
      } catch (err) {
        setCollabStatus('error');
        setError(`Не удалось синхронизировать процесс: ${err.message}`);
      } finally {
        resyncingRef.current = false;
        const queued = queuedSnapshotRef.current;
        queuedSnapshotRef.current = null;
        if (queued && !disposed) void rebaseSnapshot(queued);
      }
    };

    const applyRemoteOperations = (message) => {
      const messageRevision = Number(message.revision) || 0;
      if (messageRevision <= revisionRef.current) return;
      if (pendingBatchRef.current || messageRevision !== revisionRef.current + 1) {
        inboundOpsRef.current.set(messageRevision, message);
        if (inboundOpsRef.current.size > 150) {
          void api(`/api/processes/${activeProcessId}`).then((process) => rebaseSnapshot({ ...process, process })).catch((err) => setError(`Не удалось восстановить синхронизацию: ${err.message}`));
        }
        return;
      }
      const oldBase = baseSnapshotRef.current;
      if (!oldBase) {
        inboundOpsRef.current.set(messageRevision, message);
        return;
      }
      const localOperations = dirtyRef.current ? diffCollaborativeState(oldBase, currentStateRef.current || oldBase) : [];
      const nextBase = applyOperationsToState(oldBase, message.operations || []);
      const merged = localOperations.length ? applyOperationsToState(nextBase, localOperations) : nextBase;
      baseSnapshotRef.current = nextBase;
      revisionRef.current = messageRevision;
      if (!localOperations.length) requestedBaseRevisionRef.current = messageRevision;
      const uiState = installState(merged, nextBase);
      updateProcessMeta(nextBase, messageRevision, undefined);
      setCollabStatus(JSON.stringify(uiState) === JSON.stringify(nextBase) ? 'online' : 'syncing');
      setSyncTick((value) => value + 1);
    };

    const drainBuffered = () => {
      if (pendingBatchRef.current) return;
      while (inboundOpsRef.current.has(revisionRef.current + 1)) {
        const nextRevision = revisionRef.current + 1;
        const nextMessage = inboundOpsRef.current.get(nextRevision);
        inboundOpsRef.current.delete(nextRevision);
        applyRemoteOperations(nextMessage);
      }
      const hasGap = [...inboundOpsRef.current.keys()].some((revision) => revision > revisionRef.current + 1);
      if (hasGap) {
        void api(`/api/processes/${activeProcessId}`).then((process) => rebaseSnapshot({ ...process, process })).catch((err) => setError(`Не удалось восстановить синхронизацию: ${err.message}`));
      }
    };

    socket.onopen = () => {
      if (disposed || generation !== socketGenerationRef.current) return;
      socket.send(JSON.stringify({ type: 'auth', token }));
    };
    socket.onmessage = async (event) => {
      if (disposed || generation !== socketGenerationRef.current) return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'process_deleted') {
        setProcesses((items) => items.filter((item) => item.id !== message.process_id));
        setCurrentProcess(null); setActiveProcessId(null); setNodes([]); setEdges([]);
        setSelectedNodeId(null); setActivityOpen(false); setActivityEvents([]);
        setCostPreviewOpen(false); setProjectSettingsOpen(false); setRemoteCursors({});
        setDirty(false); setSaving(false); setCollabStatus('offline');
        setPage('canvas'); setAccessDeniedProcessId(null); setAccessDeniedReason('');
        window.history.replaceState({}, '', '/');
        setToast(`Процесс удалён владельцем ${message.deleted_by ? `«${message.deleted_by}»` : ''}.`);
        api('/api/processes').then(setProcesses).catch(() => {});
        socket.close(1000, 'process deleted');
        return;
      }
      if (message.type === 'joined') {
        collaborationJoinedRef.current = true;
        setPresence(Number(message.count) || 1);
        if (message.revision) updateProcessMeta(currentStateRef.current || {}, Number(message.revision), message.can_edit);
        setCollabStatus('syncing');
        return;
      }
      if (message.type === 'snapshot') {
        const source = message.process || message;
        const savedBy = message.saved_by || source.saved_by;
        if (savedBy) pushActivityEvent({
          revision: source.revision || message.revision, user: savedBy, created_at: source.updated_at || message.updated_at,
          operations: [{ type: 'snapshot.replace' }],
        });
        await rebaseSnapshot(message);
        return;
      }
      if (message.type === 'presence') {
        setPresence(Number(message.count) || 1);
        if (message.left) {
          setRemoteCursors((current) => Object.fromEntries(Object.entries(current).filter(([key, cursor]) => {
            if (message.client_id) return key !== String(message.client_id);
            return cursor.user !== message.user;
          })));
        }
        return;
      }
      if (message.type === 'cursor' && message.client_id && message.client_id !== localClientIdRef.current) {
        const key = String(message.client_id);
        setRemoteCursors((current) => ({ ...current, [key]: { x: Number(message.x), y: Number(message.y), coordinateSpace: message.coordinate_space === 'flow' ? 'flow' : 'normalized', color: message.color || '#86d6ff', user: message.user || 'Коллега', receivedAt: Date.now() } }));
        return;
      }
      if (message.type === 'ops') {
        pushActivityEvent(message);
        if (message.snapshot) {
          await rebaseSnapshot({ type: 'snapshot', process: message.snapshot });
        } else {
          applyRemoteOperations(message);
        }
        return;
      }
      if (message.type === 'ack') {
        if (message.operations?.length) pushActivityEvent({ ...message, created_at: message.updated_at, user: message.user || user?.username });
        const pending = pendingBatchRef.current;
        if (!pending || pending.op_id !== message.op_id) return;
        if (message.snapshot) {
          await rebaseSnapshot({ type: 'snapshot', process: message.snapshot });
          if (Array.isArray(message.conflicts) && message.conflicts.length) {
            setToast(`Изменения сохранены, но обнаружены ${message.conflicts.length} пересекающихся правок.`);
          }
          return;
        }
        const oldBase = baseSnapshotRef.current;
        if (!oldBase) return;
        const ackRevision = Number(message.revision) || revisionRef.current + 1;
        const currentAtAck = currentStateRef.current || pending.sent_state;
        const laterLocalOperations = diffCollaborativeState(pending.sent_state, currentAtAck);
        let nextBase = oldBase;
        let nextCurrent = oldBase;
        let missingRevision = false;
        for (let revision = revisionRef.current + 1; revision < ackRevision; revision += 1) {
          const buffered = inboundOpsRef.current.get(revision);
          if (!buffered) { missingRevision = true; break; }
          nextBase = applyOperationsToState(nextBase, buffered.operations || []);
          nextCurrent = applyOperationsToState(nextCurrent, buffered.operations || []);
        }
        if (missingRevision) {
          // Receipt lookup after the fresh snapshot lets us distinguish an accepted batch from a lost one.
          await rebaseSnapshot({ type: 'snapshot', process: await api(`/api/processes/${activeProcessId}`) });
          return;
        }
        nextBase = applyOperationsToState(nextBase, pending.operations);
        nextCurrent = applyOperationsToState(nextCurrent, pending.operations);
        if (laterLocalOperations.length) nextCurrent = applyOperationsToState(nextCurrent, laterLocalOperations);
        baseSnapshotRef.current = nextBase;
        revisionRef.current = ackRevision;
        for (const revision of [...inboundOpsRef.current.keys()]) if (revision <= ackRevision) inboundOpsRef.current.delete(revision);
        pendingBatchRef.current = null;
        if (pendingBatchTimerRef.current) clearTimeout(pendingBatchTimerRef.current);
        pendingBatchTimerRef.current = null;
        requestedBaseRevisionRef.current = ackRevision;
        const uiState = installState(nextCurrent, nextBase);
        updateProcessMeta(nextBase, ackRevision, undefined);
        setCollabStatus(JSON.stringify(uiState) === JSON.stringify(nextBase) ? 'online' : 'syncing');
        if (Array.isArray(message.conflicts) && message.conflicts.length) {
          setToast(`Изменения сохранены, но есть ${message.conflicts.length} пересекающихся правок. Проверьте затронутые поля.`);
        }
        setSyncTick((value) => value + 1);
        drainBuffered();
        return;
      }
      if (message.type === 'error') {
        setError(message.message || 'Ошибка синхронизации');
        setCollabStatus('error');
      }
    };
    socket.onerror = () => { if (!disposed) setCollabStatus('offline'); };
    socket.onclose = (event) => {
      if (socketRef.current === socket) socketRef.current = null;
      collaborationJoinedRef.current = false;
      collaborationSnapshotReceivedRef.current = false;
      if (disposed || generation !== socketGenerationRef.current) return;
      setCollabStatus([4401, 4403, 1011].includes(event.code) ? 'error' : 'offline');
      if ([4401, 4403].includes(event.code)) {
        setError(event.code === 4401 ? 'Сессия завершилась. Войдите снова, чтобы продолжить совместную работу.' : 'Нет доступа к процессу или этот адрес не разрешён сервером.');
        return;
      }
      if (event.code === 1011) setError('Сервер прервал синхронизацию из-за внутренней ошибки. Переподключаемся; подробности доступны в логе backend.');
      reconnectAttemptRef.current += 1;
      const delay = Math.min(10000, 500 * (2 ** Math.min(reconnectAttemptRef.current - 1, 5)));
      reconnectTimerRef.current = setTimeout(() => {
        if (!disposed) setReconnectTick((value) => value + 1);
      }, delay);
    };

    return () => {
      disposed = true;
      collaborationJoinedRef.current = false;
      collaborationSnapshotReceivedRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (socketRef.current === socket) socketRef.current = null;
      socket.close();
    };
  }, [activeProcessId, user?.id, reconnectTick, page]);

  useEffect(() => {
    if (!dirty || applyingRemoteRef.current || !currentProcess || currentProcess.can_edit === false || collabStatus === 'error' || collabStatus === 'conflict') return undefined;
    // Debounce high-frequency React Flow position updates while dragging. Without this,
    // every pointer frame becomes its own revision and can starve peer snapshots.
    const timer = setTimeout(() => {
      const socket = socketRef.current;
      if (!collaborationJoinedRef.current || !collaborationSnapshotReceivedRef.current || !socket || socket.readyState !== WebSocket.OPEN || pendingBatchRef.current) return;
      const base = baseSnapshotRef.current;
      if (!base) return;
      const current = stateFromParts({ nodes, edges, settings: processSettings, name: processName, description: processDescription, folder: processFolder });
      const operations = diffCollaborativeState(base, current);
      if (!operations.length) {
        setDirty(false); setCollabStatus('online');
        return;
      }
      const opId = makeId('op');
      const baseRevision = requestedBaseRevisionRef.current ?? revisionRef.current;
      const batchOperations = [];
      for (const operation of operations) {
        const candidate = [...batchOperations, operation];
        const encoded = JSON.stringify({ type: 'ops', op_id: opId, base_revision: baseRevision, operations: candidate });
        if (candidate.length > 100 || new TextEncoder().encode(encoded).length > 60 * 1024) break;
        batchOperations.push(operation);
      }
      if (!batchOperations.length) {
        setError('Одна операция превышает лимит синхронизации. Попробуйте сократить объём пользовательских полей; локальные изменения пока остаются в редакторе.');
        setCollabStatus('error');
        return;
      }
      const sentState = applyOperationsToState(base, batchOperations);
      const batch = { op_id: opId, operations: batchOperations, sent_state: sentState, base_revision: baseRevision };
      pendingBatchRef.current = batch;
      if (pendingBatchTimerRef.current) clearTimeout(pendingBatchTimerRef.current);
      pendingBatchTimerRef.current = setTimeout(() => {
        if (pendingBatchRef.current?.op_id !== opId) return;
        setError('Сервер не подтвердил изменение за 8 секунд. Переподключаемся и проверяем сохранённую версию, чтобы не потерять правки.');
        setCollabStatus('syncing');
        setReconnectTick((value) => value + 1);
      }, 8000);
      try {
        socket.send(JSON.stringify({ type: 'ops', op_id: opId, base_revision: batch.base_revision, operations: batchOperations }));
        setCollabStatus('syncing');
      } catch (err) {
        pendingBatchRef.current = null;
        if (pendingBatchTimerRef.current) clearTimeout(pendingBatchTimerRef.current);
        pendingBatchTimerRef.current = null;
        setCollabStatus('offline');
        setError(`Не удалось отправить изменения: ${err.message}`);
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [dirty, syncTick, nodes, edges, processSettings, processName, processDescription, processFolder, currentProcess?.id, currentProcess?.can_edit, collabStatus]);

  useEffect(() => {
    const timer = setInterval(() => {
      const cutoff = Date.now() - 6500;
      setRemoteCursors((current) => Object.fromEntries(Object.entries(current).filter(([, cursor]) => cursor.receivedAt && cursor.receivedAt >= cutoff)));
    }, 2200);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!activityOpen || !activeProcessId || !user) return undefined;
    let cancelled = false;
    setActivityLoading(true);
    api(`/api/processes/${activeProcessId}/history`)
      .then((events) => {
        if (cancelled) return;
        const mapped = (events || []).map((event) => {
          const operations = event.operations || [];
          const first = operations[0] || {};
          let action = 'обновил процесс';
          if (operations.some((operation) => operation.type === 'node.remove')) action = 'удалил блок';
          else if (operations.some((operation) => operation.type === 'node.add')) action = 'добавил блок';
          else if (operations.some((operation) => operation.type === 'set' && operation.entity === 'node' && operation.path?.[0] === 'position')) action = 'переместил блок';
          else if (operations.some((operation) => operation.type?.startsWith('edge.'))) action = 'изменил связи процесса';
          else if (first.type === 'snapshot.replace') action = 'сохранил полную версию процесса';
          return { ...event, action, op_id: `revision-${event.revision}` };
        });
        setActivityEvents((current) => {
          const merged = new Map();
          for (const event of [...mapped, ...current]) merged.set(`r:${event.revision}`, event);
          return [...merged.values()].sort((a, b) => Number(b.revision || 0) - Number(a.revision || 0)).slice(0, 150);
        });
      })
      .catch((err) => { if (!cancelled) setError(`Не удалось загрузить журнал: ${err.message}`); })
      .finally(() => { if (!cancelled) setActivityLoading(false); });
    return () => { cancelled = true; };
  }, [activityOpen, activeProcessId, user?.id]);

  const onCanvasMove = useCallback((_, viewport) => {
    if (!viewport || !Number.isFinite(viewport.zoom)) return;
    const next = { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
    canvasViewportRef.current = next;
    setCanvasViewport((current) => current.x === next.x && current.y === next.y && current.zoom === next.zoom ? current : next);
  }, []);

  const onCanvasInit = useCallback((instance) => {
    if (instance?.getViewport) onCanvasMove(null, instance.getViewport());
  }, [onCanvasMove]);

  const broadcastCursor = (event) => {
    const now = Date.now();
    if (now - lastCursorBroadcastRef.current < 45 || !canvasWrapRef.current) return;
    lastCursorBroadcastRef.current = now;
    const rect = canvasWrapRef.current.getBoundingClientRect();
    const point = screenToFlowPoint(
      { x: event.clientX - rect.left, y: event.clientY - rect.top },
      canvasViewportRef.current,
    );
    if (socketRef.current?.readyState === WebSocket.OPEN && collaborationJoinedRef.current) {
      socketRef.current.send(JSON.stringify({ type: 'cursor', coordinate_space: 'flow', client_id: localClientIdRef.current, ...point, color: '#86d6ff' }));
    }
  };

  const logout = async () => {
    try { await api('/api/presence/heartbeat', { method: 'POST', body: JSON.stringify({ client_id: presenceClientIdRef.current, online: false }) }); } catch { /* expiry cleanup also removes stale tabs */ }
    try { await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) }); } catch { /* clear local session even if API is offline */ }
    localStorage.removeItem('flowcost_token'); localStorage.removeItem('flowcost_user');
    if (pendingBatchTimerRef.current) clearTimeout(pendingBatchTimerRef.current);
    pendingBatchTimerRef.current = null; pendingBatchRef.current = null;
    window.history.pushState({}, '', '/'); setActivityOpen(false); setActivityEvents([]); setUser(null); setCurrentProcess(null); setActiveProcessId(null); setProcesses([]); setNodes([]); setEdges([]); setPage('canvas'); setDirty(false); setLoading(false); setCollabStatus('offline'); collaborationJoinedRef.current = false; collaborationSnapshotReceivedRef.current = false;
  };

  const createProcess = () => {
    if (dirty && !window.confirm('Есть несохранённые изменения. Создать новый процесс без их сохранения?')) return;
    setCreateProcessOpen(true);
  };

  const submitCreateProcess = async ({ name, description, folder, visibility }) => {
    setCreatingProcess(true);
    const start = newNode('start', 0, { name: 'Старт процесса' });
    const end = newNode('end', 1, { name: 'Завершение процесса' });
    start.position = { x: 120, y: 180 };
    end.position = { x: 500, y: 180 };
    try {
      const process = await api('/api/processes', {
        method: 'POST',
        body: JSON.stringify({
          name, description, folder, visibility,
          settings: { financial_goal_allocations: [] },
          nodes: [start, end],
          edges: [{ id: `e-${Date.now()}`, source: start.id, target: end.id, sourceHandle: 'flow-out', targetHandle: 'flow-in', type: 'smoothstep', className: 'process-flow-edge' }],
        }),
      });
      const list = await api('/api/processes');
      setProcesses(list);
      setCreateProcessOpen(false);
      window.history.pushState({}, '', processPath(process.id));
      await loadProcess(process.id);
      setToast(visibility === 'public' ? 'Создан общий процесс — всем доступен просмотр' : 'Создан закрытый процесс');
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setCreatingProcess(false);
    }
  };

  const deleteProcess = async (processId) => {
    const process = processes.find((item) => item.id === processId);
    if (!process || process.owner_id !== user?.id) return;
    if (!window.confirm(`Удалить процесс «${process.name}»? Это действие нельзя отменить.`)) return;
    try {
      await api(`/api/processes/${encodeURIComponent(processId)}`, { method: 'DELETE' });
      const list = await api('/api/processes');
      setProcesses(list);
      if (activeProcessId === processId) {
        window.history.pushState({}, '', '/');
        setActiveProcessId(null); setCurrentProcess(null); setNodes([]); setEdges([]);
        setSelectedNodeId(null); setActivityOpen(false); setCostPreviewOpen(false); setProjectSettingsOpen(false);
        setRemoteCursors({}); setDirty(false); setCollabStatus('offline');
      }
      setToast('Процесс удалён');
    } catch (err) {
      setError(`Не удалось удалить процесс: ${err.message}`);
    }
  };
  const duplicateCurrent = async () => {
    if (!currentProcess) return;
    try { const copy = await api(`/api/processes/${currentProcess.id}/duplicate`, { method: 'POST', body: JSON.stringify({ name: `${currentProcess.name} — копия` }) }); const list = await api('/api/processes'); setProcesses(list); window.history.pushState({}, '', processPath(copy.id)); setActivityOpen(false); await loadProcess(copy.id); setToast('Создана копия процесса'); }
    catch (err) { setError(err.message); }
  };

  const addStep = (type) => {
    const node = newNode(type, nodes.length);
    if (type === 'subprocess') {
      const source = processes.find((process) => process.id === libraryChoice && process.id !== activeProcessId);
      if (!source) { setError('Выберите другой процесс в списке «Библиотека блоков», затем нажмите «Вставить блок».'); return; }
      node.data = { ...node.data, name: source.name, description: source.description, source_process_id: source.id, subprocess_snapshot: { nodes: source.nodes, edges: source.edges }, inputs: 'Входные данные встроенного процесса', outputs: 'Результат встроенного процесса' };
    }
    recordHistory(); setNodes((items) => [...items, node]); setSelectedNodeId(node.id); markDirty();
  };

  const insertProcessAsBlock = () => addStep('subprocess');
  const importJSON = async (event) => {
    const file = event.target.files?.[0]; if (!file) return;
    try { const payload = JSON.parse(await file.text()); const process = await api('/api/import/json', { method: 'POST', body: JSON.stringify(payload) }); const list = await api('/api/processes'); setProcesses(list); window.history.pushState({}, '', processPath(process.id)); setActivityOpen(false); await loadProcess(process.id); setToast('JSON-процесс импортирован'); }
    catch (err) { setError(`Не удалось импортировать JSON: ${err.message}`); }
    finally { event.target.value = ''; setMenuOpen(false); }
  };

  const download = async (extension) => {
    if (!currentProcess) return;
    try {
      const blob = await api(`/api/processes/${currentProcess.id}/export.${extension}`);
      const href = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = href; a.download = `flowcost-${currentProcess.name.replace(/[^\w\-а-яё]+/gi, '-').slice(0, 45)}.${extension}`; a.click(); URL.revokeObjectURL(href);
      setToast(extension === 'xlsx' ? 'Excel-файл подготовлен' : 'JSON-файл подготовлен');
    } catch (err) { setError(err.message); }
  };

  const navigateProcessSubview = (subview, replace = false) => {
    if (!activeProcessId) return;
    setPage('canvas');
    setActivityOpen(subview === 'activity');
    setCostPreviewOpen(subview === 'estimate');
    setProjectSettingsOpen(subview === 'settings');
    setViewMode(subview === 'responsibility' ? 'responsibility' : 'canvas');
    setMenuOpen(false);
    const method = replace ? 'replaceState' : 'pushState';
    window.history[method]({}, '', processPath(activeProcessId, subview));
  };

  const navigateTeamTab = (nextTab) => {
    const tab = ['team', 'tools', 'goals', 'online', 'admin'].includes(nextTab) ? nextTab : 'team';
    setMenuOpen(false); setPage('team'); setTeamTab(tab);
    setActivityOpen(false); setCostPreviewOpen(false); setProjectSettingsOpen(false); setViewMode('canvas');
    window.history.pushState({}, '', teamPath(tab));
  };

  const navigatePage = (nextPage) => {
    setMenuOpen(false);
    if (nextPage === 'team') {
      navigateTeamTab('team');
    } else if (nextPage === 'online') {
      navigateTeamTab('online');
    } else if (nextPage === 'admin') {
      navigateTeamTab('admin');
    } else if (activeProcessId) navigateProcessSubview('canvas');
  };

  const copyProcessLink = async (id = activeProcessId) => {
    if (!id) return;
    const url = new URL(processPath(id), window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(url);
      setToast('Ссылка на процесс скопирована');
    } catch {
      window.prompt('Скопируйте ссылку на процесс:', url);
    }
  };

  const openActivity = () => {
    if (!activeProcessId) return;
    navigateProcessSubview(activityOpen ? 'canvas' : 'activity');
  };

  const requestAccessToDeepLinkedProcess = async () => {
    if (!accessDeniedProcessId || accessRequestBusy) return;
    setAccessRequestBusy(true);
    try {
      const result = await api(`/api/processes/${encodeURIComponent(accessDeniedProcessId)}/access-request`, { method: 'POST', body: JSON.stringify({}) });
      if (result.status === 'already_shared') {
        await loadProcess(accessDeniedProcessId);
        window.history.replaceState({}, '', processPath(accessDeniedProcessId));
        setToast('Доступ уже есть — процесс открыт.');
      } else {
        setAccessRequestSent(true);
        setToast(`Запрос доступа отправлен${result.owner_username ? ` пользователю ${result.owner_username}` : ''}.`);
      }
    } catch (err) { setAccessDeniedReason(err.message); }
    finally { setAccessRequestBusy(false); }
  };

  const openProcessFromOnline = (processId) => {
    setPage('canvas'); setTeamTab('team'); setAccessDeniedProcessId(null); setAccessDeniedReason('');
    window.history.pushState({}, '', processPath(processId));
    loadProcess(processId).catch((err) => { setPage('access'); setAccessDeniedProcessId(processId); setAccessDeniedReason(err.message); });
  };

  const switchProcess = (id) => {
    if (dirty && id !== activeProcessId && !window.confirm('Есть несохранённые изменения. Переключиться без сохранения?')) return;
    if (id === activeProcessId) {
      navigateProcessSubview('canvas');
      return;
    }
    window.history.pushState({}, '', processPath(id));
    setPage('canvas'); setActivityOpen(false); setCostPreviewOpen(false); setProjectSettingsOpen(false); setViewMode('canvas'); setActivityEvents([]);
    loadProcess(id).catch((err) => setError(err.message));
  };

  const removeSelectedNode = () => {
    if (!selectedNode) return;
    if (selectedNode.type === 'group') { ungroupNode(selectedNode.id); return; }
    recordHistory(); setNodes((items) => items.filter((node) => node.id !== selectedNode.id));
    setEdges((items) => items.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id));
    setSelectedNodeId(null); markDirty();
  };

  const addGroupShape = () => {
    const group = newNode('group', nodes.length);
    recordHistory();
    group.position = { x: 180 + (nodes.length % 4) * 80, y: 150 + Math.floor(nodes.length / 4) * 80 };
    group.style = { width: 360, height: 230 };
    setNodes((items) => [group, ...items]); setSelectedNodeId(group.id); markDirty();
  };
  const groupSelectedNodes = () => {
    const chosen = nodes.filter((node) => node.selected && !node.parentId && !['group', 'sticker'].includes(node.type));
    const selected = chosen.length >= 2 ? chosen : selectedNode && !selectedNode.parentId && selectedNode.type !== 'group' && selectedNode.type !== 'sticker' ? [selectedNode] : [];
    if (selected.length < 2) { setError('Выберите минимум два этапа: удерживайте Shift при выборе или выделите область на холсте.'); return; }
    recordHistory();
    const padding = 30;
    const minX = Math.min(...selected.map((node) => node.position.x));
    const minY = Math.min(...selected.map((node) => node.position.y));
    const maxX = Math.max(...selected.map((node) => node.position.x + (node.measured?.width || node.width || 240)));
    const maxY = Math.max(...selected.map((node) => node.position.y + (node.measured?.height || node.height || 150)));
    const group = newNode('group', nodes.length, { name: 'Группа этапов', description: 'Связанные этапы процесса' });
    group.position = { x: minX - padding, y: minY - padding };
    group.style = { width: maxX - minX + padding * 2, height: maxY - minY + padding * 2 };
    const ids = new Set(selected.map((node) => node.id));
    const changed = nodes.map((node) => ids.has(node.id) ? { ...node, parentId: group.id, extent: 'parent', position: { x: node.position.x - group.position.x, y: node.position.y - group.position.y }, selected: false } : node);
    setNodes([group, ...changed]); setSelectedNodeId(group.id); markDirty(); setToast(`Объединено элементов: ${selected.length}`);
  };
  const ungroupNode = (groupId) => {
    const group = nodes.find((node) => node.id === groupId && node.type === 'group');
    if (!group) return;
    recordHistory();
    const ungrouped = nodes.filter((node) => node.parentId === groupId).map((node) => ({ ...node, parentId: undefined, extent: undefined, position: { x: group.position.x + node.position.x, y: group.position.y + node.position.y } }));
    setNodes((items) => [...items.filter((node) => node.id !== groupId && node.parentId !== groupId), ...ungrouped]);
    setSelectedNodeId(null); markDirty(); setToast('Группа разгруппирована');
  };

  const addFromLibrary = (process) => {
    if (!currentProcess || process.id === currentProcess.id) return;
    recordHistory();
    const idMap = new Map();
    const offsetX = 160 + (nodes.length % 3) * 60;
    const offsetY = 100 + Math.floor(nodes.length / 3) * 50;
    const copiedNodes = process.nodes.map((node, index) => {
      const id = `imp-${Date.now()}-${index}-${Math.random().toString(16).slice(2, 4)}`;
      idMap.set(node.id, id);
      return { ...node, id, parentId: node.parentId ? idMap.get(node.parentId) : undefined, position: node.parentId ? { ...(node.position || { x: 0, y: 0 }) } : { x: (node.position?.x || 0) + offsetX, y: (node.position?.y || 0) + offsetY }, data: { ...node.data, assignments: (node.data?.assignments || []).map((a) => ({ ...a })) } };
    });
    const copiedEdges = process.edges.filter((edge) => idMap.has(edge.source) && idMap.has(edge.target)).map((edge, index) => ({ ...edge, id: `imp-e-${Date.now()}-${index}`, source: idMap.get(edge.source), target: idMap.get(edge.target) }));
    setNodes((items) => [...items, ...copiedNodes]); setEdges((items) => [...items, ...copiedEdges]); markDirty(); setToast(`Вставлено ${copiedNodes.length} этапов из «${process.name}»`);
  };

  if (loading) return <div className="loading-screen"><div className="loading-mark"><Workflow size={26} /></div><strong>FlowCost</strong><span>Открываем рабочее пространство…</span></div>;
  if (!user) return <AuthScreen onAuthenticated={handleAuthenticated} initialError={error} />;

  const canManageShare = Boolean(currentProcess && currentProcess.owner_id === user.id);
  const formattedCost = `${RUB.format(summary.total_with_financial_goals ?? summary.cost)} ${currency === 'RUB' ? '₽' : currency}`;
  const connectionLabel = collabStatus === 'online' ? 'Синхронизировано' : collabStatus === 'connecting' ? 'Подключение…' : collabStatus === 'syncing' ? 'Синхронизация…' : collabStatus === 'conflict' ? 'Конфликт версий' : collabStatus === 'error' ? 'Ошибка синхронизации' : 'Оффлайн';
  const saveStateLabel = saving ? 'Сохраняем…' : collabStatus === 'error' ? 'Ошибка синхронизации' : collabStatus === 'conflict' ? 'Конфликт версий' : collabStatus === 'offline' ? (dirty ? 'Ожидает подключения' : 'Оффлайн') : dirty ? (collaborationJoinedRef.current ? 'Отправка изменений…' : 'Ожидает сохранения') : connectionLabel;
  const saveStateClass = collabStatus === 'error' ? 'is-error' : collabStatus === 'conflict' ? 'is-error' : collabStatus === 'offline' ? 'is-offline' : dirty || saving ? 'is-dirty' : collabStatus === 'online' ? 'is-saved' : 'is-syncing';
  const saveStateDotClass = collabStatus === 'error' || collabStatus === 'conflict' || collabStatus === 'offline' ? 'offline-dot' : dirty || saving ? 'dirty-dot' : collabStatus === 'online' ? 'live-dot' : 'dirty-dot';
  return <div className={`app-shell ${sidebarOpen ? '' : 'sidebar-collapsed'}`}>
    <Sidebar processes={sortedProcesses} activeProcessId={activeProcessId} onSelect={switchProcess} onNew={createProcess} onDelete={deleteProcess} page={page} teamTab={teamTab} setPage={navigatePage} open={sidebarOpen} onCopyLink={copyProcessLink} setSortOrder={setSortOrder} sortOrder={sortOrder} user={user} onLogout={logout} />
    <main className="main-area">
      {error && <div className="global-error"><span>{error}</span><button className="icon-button" onClick={() => setError('')}><X size={15} /></button></div>}
      {page === 'team' ? (teamTab === 'online' ? <OnlinePage currentUser={user} onOpenProcess={openProcessFromOnline} /> : teamTab === 'admin' ? <AdminRegistrationsPage /> : <TeamPage team={team} reloadTeam={reloadTeam} tools={tools} reloadTools={reloadTools} roleGrades={roleGrades} reloadRoleGrades={reloadRoleGrades} financialGoals={financialGoals} reloadFinancialGoals={reloadFinancialGoals} activeTab={teamTab} onTabChange={navigateTeamTab} />) : page === 'access' ? <div className="access-denied-page"><div className="access-denied-icon"><ShieldAlert size={26} /></div><span className="eyebrow">ОБЩИЙ ДОСТУП</span><h1>Этот процесс не доступен вашему аккаунту</h1><p>{accessRequestSent ? 'Запрос отправлен владельцу. После одобрения откройте эту же ссылку ещё раз — граф и журнал будут общими.' : accessDeniedReason || 'Владелец процесса должен предоставить вам доступ.'}</p><p>Каждый процесс имеет собственный идентификатор. Чтобы работать вместе, откройте одну и ту же ссылку на процесс; если он закрытый, запросите доступ у владельца.</p><div className="access-denied-actions"><button className="button primary" onClick={requestAccessToDeepLinkedProcess} disabled={accessRequestBusy || accessRequestSent}><UsersRound size={15} /> {accessRequestBusy ? 'Отправляем…' : accessRequestSent ? 'Запрос отправлен' : 'Запросить доступ на редактирование'}</button><button className="button secondary" onClick={() => navigateTeamTab('online')}>Коллеги онлайн</button></div></div> : currentProcess ? <>
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button sidebar-toggle" onClick={() => setSidebarOpen((open) => !open)} title={sidebarOpen ? 'Скрыть список процессов' : 'Показать список процессов'}><Menu size={18} /></button>
            <div className="process-heading">
              <div className="breadcrumb">WORKSPACE <span>/</span> PROCESS DESIGNER <span>/</span> {currentProcess.folder || 'БЕЗ ПАПКИ'}</div>
              <input className="process-name-input" value={processName} disabled={!canEdit} onChange={(event) => { setProcessName(event.target.value); markDirty(); }} placeholder="Название процесса" />
              <div className="process-meta-fields">
                <input className="process-description-input" value={processDescription} disabled={!canEdit} onChange={(event) => { setProcessDescription(event.target.value); markDirty(); }} placeholder="Коротко опишите назначение процесса" />
                <label className="process-folder-input"><FolderOpen size={12} /><input value={processFolder} disabled={!canEdit} onChange={(event) => { setProcessFolder(event.target.value); markDirty(); }} placeholder="Папка процесса" /></label>
              </div>
            </div>
          </div>
          <div className="topbar-right">
            <div className="topbar-metrics">
              <div className="topbar-metric primary-metric"><span><CircleDollarSign size={13} /> Смета</span><strong>{formattedCost}</strong></div>
              <div className="topbar-metric"><span><Activity size={13} /> Трудоёмкость</span><strong>{HOURS.format(summary.hours)} ч</strong></div>
              <div className="topbar-metric"><span><Blocks size={13} /> Структура</span><strong>{nodes.filter((node) => !['group', 'sticker', 'risk'].includes(node.type)).length} этапов · {edges.filter((edge) => !isDataFlowEdge(edge)).length} связей</strong></div>
            </div>
            <div className={`save-state ${saveStateClass}`} title={error || `Совместная работа: ${connectionLabel}`}><span className={saveStateDotClass} />{saveStateLabel}</div>
            <button className={`button secondary hamburger-menu-trigger ${menuOpen ? 'active' : ''}`} onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen}><Menu size={16} /> Меню <ChevronDown size={13} /></button>
          </div>
          {menuOpen && <div className="topbar-menu-popover">
            <div className="menu-popover-header"><div><span className="eyebrow">ПРОЦЕСС</span><strong>{processName || 'Без названия'}</strong><small>{currentProcess.folder || 'Без папки'} · {presence} онлайн</small></div><button className="icon-button" onClick={() => setMenuOpen(false)} aria-label="Закрыть меню"><X size={15} /></button></div>
            <div className="menu-summary-grid"><div><span>Самый дорогой сценарий</span><strong>{formattedCost}</strong></div><div><span>Часы команды</span><strong>{HOURS.format(summary.hours)} ч</strong></div><div><span>Труд</span><strong>{RUB.format(summary.laborCost || 0)} {currency}</strong></div><div><span>Инструменты</span><strong>{RUB.format(summary.toolCost || 0)} {currency}</strong></div></div>
            <div className="menu-action-grid">
              <button className="menu-action" onClick={() => { saveProcess(true); setMenuOpen(false); }} disabled={!canEdit || saving || !dirty}><Save size={15} /><span><strong>Сохранить сейчас</strong><small>Автосохранение также включено</small></span></button>
              <button className="menu-action" onClick={() => { duplicateCurrent(); setMenuOpen(false); }} disabled={!canEdit}><Copy size={15} /><span><strong>Создать копию</strong><small>Дублировать текущий процесс</small></span></button>
              <button className="menu-action" onClick={() => { copyProcessLink(); setMenuOpen(false); }}><Link2 size={15} /><span><strong>Скопировать ссылку</strong><small>Открыть этот процесс напрямую</small></span></button>
              <button className="menu-action" onClick={openActivity}><Activity size={15} /><span><strong>Журнал событий</strong><small>Кто и когда менял процесс</small></span></button>
              <button className="menu-action" onClick={() => { fileRef.current?.click(); setMenuOpen(false); }} disabled={!canEdit}><Upload size={15} /><span><strong>Импортировать JSON</strong><small>Загрузить структуру процесса</small></span></button>
              <button className="menu-action" onClick={() => { download('json'); setMenuOpen(false); }}><FileJson size={15} /><span><strong>Экспорт JSON</strong><small>Сохранить структуру</small></span></button>
              <button className="menu-action" onClick={() => { download('xlsx'); setMenuOpen(false); }}><FileSpreadsheet size={15} /><span><strong>Экспорт Excel</strong><small>Смета, этапы, роли и связи</small></span></button>
              <button className="menu-action" onClick={() => navigateProcessSubview('settings')} disabled={!canEdit}><Settings2 size={15} /><span><strong>Настройки сметы</strong><small>Процент отчислений в финансовые цели</small></span></button>
              <button className="menu-action" onClick={() => navigateProcessSubview(costPreviewOpen ? 'canvas' : 'estimate')}><Calculator size={15} /><span><strong>{costPreviewOpen ? 'Скрыть предпросмотр сметы' : 'Предпросмотр сметы'}</strong><small>Посмотреть раскладку без экспорта</small></span></button>
              <button className="menu-action" onClick={() => { setShortcutsOpen(true); setMenuOpen(false); }}><CircleHelp size={15} /><span><strong>Горячие клавиши</strong><small>Открыть справку</small></span></button>
              {canManageShare && <button className="menu-action" onClick={() => { setShareOpen(true); setMenuOpen(false); }}><Share2 size={15} /><span><strong>Совместная работа</strong><small>Пригласить по логину</small></span></button>}
              <button className="menu-action" onClick={() => { const next = !showHints; setShowHints(next); localStorage.setItem('flowcost_show_hints', String(next)); }}><EyeOff size={15} /><span><strong>{showHints ? 'Скрыть подсказки' : 'Показать подсказки'}</strong><small>Управление подсказками на холсте</small></span></button>
            </div>
            <div className="menu-bottom-row"><span><UserRound size={14} /> {user.username} · {presence} онлайн</span><button className="text-button logout-menu-button" onClick={logout}><LogOut size={13} /> Выйти</button></div>
          </div>}
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={importJSON} />
        </header>
        {multiCurrency && <div className="warning-banner">В ресурсах несколько валют. Сейчас стоимость суммируется без конвертации — перед расчётом зафиксируйте единую валюту ставок и инструментов.</div>}
        {!canEdit && <div className="readonly-banner"><Eye size={15} /> Режим просмотра · изменения доступны только владельцу или редакторам процесса.</div>}
        <section className={`workspace ${costPreviewOpen ? 'with-estimate-preview' : ''} ${canEdit ? '' : 'readonly-workspace'}`}>
          <div className="canvas-column">
            <div className="canvas-toolbar">
              <div className="toolbar-group"><span className="toolbar-label">ДОБАВИТЬ УЗЕЛ</span><button className="tool-button" disabled={!canEdit} onClick={() => addStep('task')}><Plus size={14} /> Этап</button><button className="tool-button decision-tool" disabled={!canEdit} onClick={() => addStep('decision')}><GitBranch size={14} /> Решение</button><button className="tool-button" disabled={!canEdit} onClick={() => addStep('end')}>■ Завершение</button><button className="tool-button sticker-tool" disabled={!canEdit} onClick={() => addStep('sticker')}><StickyNote size={14} /> Стикер</button><button className="tool-button risk-tool" disabled={!canEdit} onClick={() => addStep('risk')}><ShieldAlert size={14} /> Риск</button><button className="tool-button" disabled={!canEdit} onClick={addGroupShape}><Blocks size={14} /> Группа</button><button className="tool-button" disabled={!canEdit} onClick={groupSelectedNodes} title="Ctrl+G — объединить выбранные этапы"><Keyboard size={14} /> Ctrl+G</button></div>
              <div className="toolbar-group view-toggle-group"><span className="toolbar-label">ПРЕДСТАВЛЕНИЕ</span><button className={`tool-button view-mode-button ${viewMode === 'canvas' ? 'active' : ''}`} onClick={() => navigateProcessSubview('canvas')}><LayoutGrid size={14} /> Холст</button><button className={`tool-button view-mode-button ${viewMode === 'responsibility' ? 'active' : ''}`} onClick={() => navigateProcessSubview('responsibility')}><ListTree size={14} /> Зоны ответственности</button></div>
              <div className="toolbar-group utility-toolbar"><button className={`tool-button ${costPreviewOpen ? 'active' : ''}`} onClick={() => navigateProcessSubview(costPreviewOpen ? 'canvas' : 'estimate')}><Calculator size={14} /> Смета</button><button className={`tool-button ${activityOpen ? 'active' : ''}`} onClick={openActivity}><Activity size={14} /> Журнал</button><button className="tool-button" onClick={() => { const next = !showHints; setShowHints(next); localStorage.setItem('flowcost_show_hints', String(next)); }} title={showHints ? 'Скрыть подсказки' : 'Показать подсказки'}>{showHints ? <EyeOff size={14} /> : <Eye size={14} />}{showHints ? 'Подсказки' : 'Подсказки скрыты'}</button><button className="icon-button" onClick={() => setShortcutsOpen(true)} title="Справка по горячим клавишам"><CircleHelp size={16} /></button></div>
              {viewMode === 'canvas' && <div className="toolbar-group library-group"><span className="toolbar-label">БИБЛИОТЕКА БЛОКОВ</span><select disabled={!canEdit} value={libraryChoice} onChange={(e) => setLibraryChoice(e.target.value)}><option value="">Выберите процесс…</option>{processes.filter((process) => process.id !== activeProcessId).map((process) => <option key={process.id} value={process.id}>{process.folder ? `${process.folder} / ` : ''}{process.name}</option>)}</select><button className="tool-button" disabled={!canEdit} onClick={insertProcessAsBlock} title="Добавить выбранный процесс как один вложенный блок"><Plus size={13} /> Блок</button><button className="tool-button" disabled={!canEdit} onClick={() => { const process = processes.find((item) => item.id === libraryChoice); if (process) addFromLibrary(process); else setError('Сначала выберите процесс в библиотеке блоков.'); }} title="Скопировать все узлы и связи выбранного процесса на текущий холст"><ArrowDownToLine size={13} /> Развернуть</button></div>}
            </div>
            {showHints && viewMode === 'canvas' && <div className="canvas-hint"><span className="hint-dot" /> Серые связи — маршрут; синие пунктирные — синхронизация данных. Shift — мультивыбор · Ctrl+G — группа · N / S / R — этап / стикер / риск.<button className="hint-dismiss" onClick={() => { setShowHints(false); localStorage.setItem('flowcost_show_hints', 'false'); }}>Скрыть</button></div>}
            <div className="canvas-wrap" ref={canvasWrapRef} onPointerMoveCapture={viewMode === 'canvas' ? broadcastCursor : undefined}>
              {viewMode === 'canvas' ? <>
                <ReactFlow nodes={flowNodes} edges={edges} nodeTypes={nodeTypes} onInit={onCanvasInit} onMove={onCanvasMove} onNodesChange={canEdit ? onNodesChange : undefined} onNodeDragStart={canEdit ? recordHistory : undefined} onEdgesChange={canEdit ? onEdgesChange : undefined} onConnect={canEdit ? onConnect : undefined} onNodeClick={(_, node) => setSelectedNodeId(node.id)} onPaneClick={() => setSelectedNodeId(null)} nodesDraggable={canEdit} nodesConnectable={canEdit} elementsSelectable selectionOnDrag={canEdit} selectionMode={SelectionMode.Partial} multiSelectionKeyCode="Shift" panOnDrag={[1, 2]} fitView fitViewOptions={{ padding: 0.2 }} minZoom={0.15} maxZoom={1.6} defaultEdgeOptions={{ type: 'smoothstep' }} deleteKeyCode={canEdit ? ['Backspace', 'Delete'] : null} proOptions={{ hideAttribution: true }}>
                  <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#3a3f48" /><Controls position="bottom-left" /><MiniMap position="bottom-right" nodeStrokeWidth={3} zoomable pannable />
                </ReactFlow>
                <RemoteCursors
                  cursors={remoteCursors}
                  viewport={canvasViewport}
                  width={canvasWrapRef.current?.clientWidth || 0}
                  height={canvasWrapRef.current?.clientHeight || 0}
                />
                {nodes.length === 0 && <div className="canvas-empty"><Workflow size={28} /><strong>Пока нет этапов</strong><p>Добавьте первый этап с панели выше.</p><button className="button primary" disabled={!canEdit} onClick={() => addStep('task')}><Plus size={15} /> Добавить этап</button></div>}
              </> : <ResponsibilityView nodes={nodes} team={team} roleGrades={roleGrades} onPatchAssignment={patchAssignmentForNode} onOpenNode={(id) => { setSelectedNodeId(id); navigateProcessSubview('canvas'); }} />}
            </div>
            {viewMode === 'canvas' && <div className="canvas-footer"><div><span className="legend-dot dot-task" /> Этап / задача <span className="legend-dot dot-decision" /> Решение <span className="legend-dot dot-start" /> Старт / завершение <span className="data-edge-legend" /> Синхронизация данных</div><span>{presence > 1 ? `${presence - 1} коллег(а) онлайн` : 'Вы работаете один'} · Ctrl+Shift+G — разгруппировать</span></div>}
          </div>
          {activityOpen ? <ActivityPanel processName={processName} events={activityEvents} loading={activityLoading} onClose={openActivity} onCopyLink={() => copyProcessLink()} /> : costPreviewOpen ? <CostPreviewSidebar nodes={nodes} team={team} tools={tools} roleGrades={roleGrades} summary={summary} currency={currency} onClose={() => navigateProcessSubview('canvas')} /> : <NodeEditor node={selectedNode} nodes={nodes} edges={edges} team={team} tools={tools} roleGrades={roleGrades} onChange={patchNodeData} onDelete={removeSelectedNode} onAddAssignment={addAssignment} onPatchAssignment={patchAssignment} onRemoveAssignment={removeAssignment} onPatchEdge={patchEdge} onPatchPort={patchPort} onAddPort={addPort} onRemovePort={removePort} onRemoveConnection={removeConnection} onUngroup={() => ungroupNode(selectedNode?.id)} onClose={() => setSelectedNodeId(null)} />}
        </section>
        <section className="cost-footer"><div className="cost-footer-title"><CircleDollarSign size={17} /><div><strong>Как считается стоимость</strong><span>Труд: часы × ставка обязательного грейда роли. Инструменты: доля месячной лицензии по календарным дням. Финансовые цели — отдельный резерв сверх базовой сметы.</span></div></div><div className="cost-footer-metric"><small>Стоимость всех этапов с альтернативами</small><strong>{RUB.format(nodes.reduce((sum, node) => sum + getNodeCost(node, Object.fromEntries(team.map((member) => [String(member.id), member])), Object.fromEntries(tools.map((tool) => [String(tool.id), tool])), Object.fromEntries(roleGrades.map((grade) => [String(grade.id), grade]))).cost, 0))} {currency === 'RUB' ? '₽' : currency}</strong></div><div className="cost-footer-text">Итоговый бюджет маршрута выбирает самую дорогую альтернативу и не складывает взаимоисключающие ветки. Это внутренняя себестоимость, а не клиентская цена.</div></section>
      </> : <div className="empty-workspace"><Workflow size={30} /><h2>Добро пожаловать в FlowCost</h2><p>Создайте процесс, чтобы описать этапы, распределить задачи и рассчитать внутреннюю себестоимость.</p><button className="button primary" onClick={createProcess}><Plus size={15} /> Создать процесс</button></div>}
    </main>
    {createProcessOpen && <CreateProcessModal onClose={() => setCreateProcessOpen(false)} onCreate={submitCreateProcess} busy={creatingProcess} />}
    {shareOpen && currentProcess && canManageShare && <ShareModal process={currentProcess} onClose={() => setShareOpen(false)} />}
    {projectSettingsOpen && currentProcess && <ProjectSettingsModal settings={processSettings} goals={financialGoals} baseCost={baseSummary.cost} durationDays={baseSummary.days} onClose={() => navigateProcessSubview('canvas')} onSave={(nextSettings) => { recordHistory(); setProcessSettings(nextSettings); markDirty(); navigateProcessSubview('canvas', true); setToast('Настройки финансовых целей обновлены'); }} />}
    {shortcutsOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShortcutsOpen(false); }}><div className="modal-card shortcuts-modal"><div className="modal-heading"><div><span className="eyebrow">QUICK REFERENCE</span><h2>Горячие клавиши</h2></div><button className="icon-button" onClick={() => setShortcutsOpen(false)}><X size={17} /></button></div><p className="field-help">Сочетания для быстрого редактирования холста. В полях ввода браузерные сочетания остаются активны.</p><div className="shortcut-list"><div><kbd>N</kbd><span>Добавить этап</span></div><div><kbd>S</kbd><span>Добавить стикер</span></div><div><kbd>R</kbd><span>Добавить риск</span></div><div><kbd>G</kbd><span>Добавить пустую группу</span></div><div><kbd>Ctrl / ⌘ + G</kbd><span>Сгруппировать выбранные узлы</span></div><div><kbd>Ctrl / ⌘ + Shift + G</kbd><span>Разгруппировать выбранную группу</span></div><div><kbd>Ctrl / ⌘ + Z</kbd><span>Отменить последнее действие в этой сессии</span></div><div><kbd>Ctrl / ⌘ + S</kbd><span>Сохранить сейчас</span></div><div><kbd>?</kbd><span>Открыть эту справку</span></div><div><kbd>Esc</kbd><span>Закрыть меню или справку</span></div></div><div className="shortcuts-footnote">История отмены хранится в текущей сессии браузера и сбрасывается при открытии другого процесса. Автосохранение включено.</div><div className="modal-actions"><button className="button primary" onClick={() => setShortcutsOpen(false)}>Понятно</button></div></div></div>}
    {toast && <div className="toast"><span className="toast-check">✓</span>{toast}</div>}
  </div>;
}
