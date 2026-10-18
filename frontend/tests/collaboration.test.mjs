import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeProcessEdges,
  normalizeProcessNodes,
} from '../src/lib/processModel.js';
import {
  stateFromParts,
  diffCollaborativeState,
  applyOperationsToState,
} from '../src/lib/collaborationProtocol.js';
import { readRoute, processPath, teamPath } from '../src/lib/routes.js';

const team = [{ id: 'member-1', role: 'Designer', name: 'Test Designer' }];
const grades = [{ id: 'grade-1', role: 'Designer', name: 'Middle', hourly_rate: 1200, is_default: true }];
const makeServerSnapshot = () => ({
  name: 'Shared process', description: '', folder: '', settings: {},
  nodes: [
    { id: 'node-1', type: 'task', position: { x: 30, y: 40 }, data: {
      name: 'Design', assignments: [{ id: 'work-1', member_id: 'member-1', role: 'Designer', hours: 2 }],
      inputs: ['brief'], outputs: ['figma'],
    } },
    { id: 'node-2', type: 'end', position: { x: 300, y: 40 }, data: { name: 'Done' } },
  ],
  edges: [{ id: 'edge-1', source: 'node-1', target: 'node-2', type: 'smoothstep' }],
});

function normalizeSnapshot(snapshot) {
  return stateFromParts({
    ...snapshot,
    nodes: normalizeProcessNodes(snapshot.nodes, team, grades),
    edges: normalizeProcessEdges(snapshot.edges),
  });
}

test('normalized snapshot is a stable collaborative baseline (no synthetic dirty operations)', () => {
  const normalized = normalizeSnapshot(makeServerSnapshot());
  assert.deepEqual(diffCollaborativeState(normalized, structuredClone(normalized)), []);
});

test('node movement becomes a position operation and applies on a peer snapshot', () => {
  const baseline = normalizeSnapshot(makeServerSnapshot());
  const changed = structuredClone(baseline);
  changed.nodes.find((node) => node.id === 'node-1').position.x = 240;
  const operations = diffCollaborativeState(baseline, changed);
  assert.ok(operations.some((op) => op.type === 'set' && op.entity === 'node' && op.entity_id === 'node-1' && op.path.join('/') === 'position/x'));
  const peer = applyOperationsToState(baseline, operations);
  assert.equal(peer.nodes.find((node) => node.id === 'node-1').position.x, 240);
});

test('node deletion becomes an operation and removes connected elements from the model', () => {
  const baseline = normalizeSnapshot(makeServerSnapshot());
  const changed = structuredClone(baseline);
  changed.nodes = changed.nodes.filter((node) => node.id !== 'node-1');
  changed.edges = changed.edges.filter((edge) => edge.source !== 'node-1' && edge.target !== 'node-1');
  const operations = diffCollaborativeState(baseline, changed);
  assert.ok(operations.some((op) => op.type === 'node.remove' && op.node_id === 'node-1'));
  const peer = applyOperationsToState(baseline, operations);
  assert.ok(!peer.nodes.some((node) => node.id === 'node-1'));
});


test('process views have stable direct URLs and round-trip route parsing', () => {
  for (const subview of ['canvas', 'activity', 'estimate', 'settings', 'responsibility']) {
    const path = processPath('process-123', subview);
    const route = readRoute(path);
    assert.equal(route.page, 'canvas');
    assert.equal(route.processId, 'process-123');
    assert.equal(route.subview, subview);
  }
  assert.deepEqual(readRoute('/team'), { page: 'team', processId: null, subview: 'canvas', activityOpen: false, teamTab: 'team' });
  assert.equal(readRoute(teamPath('tools')).teamTab, 'tools');
  assert.equal(readRoute(teamPath('goals')).teamTab, 'goals');
  assert.equal(readRoute(teamPath('online')).teamTab, 'online');
  assert.equal(teamPath('online'), '/team/online');
});


test('public cursor coordinate transforms stay anchored to graph space through zoom and pan', async () => {
  const { screenToFlowPoint, flowToScreenPoint, isPointVisible } = await import('../src/lib/cursorCoordinates.js');
  const senderViewport = { x: -350, y: 120, zoom: 0.75 };
  const receiverViewport = { x: 160, y: -90, zoom: 1.35 };
  const senderScreenPoint = { x: 540, y: 390 };
  const worldPoint = screenToFlowPoint(senderScreenPoint, senderViewport);
  const receiverScreenPoint = flowToScreenPoint(worldPoint, receiverViewport);
  assert.deepEqual(worldPoint, { x: 1186.6666666666667, y: 360 });
  assert.ok(Number.isFinite(receiverScreenPoint.x) && Number.isFinite(receiverScreenPoint.y));
  assert.deepEqual(flowToScreenPoint(screenToFlowPoint(senderScreenPoint, senderViewport), senderViewport), senderScreenPoint);
  assert.equal(isPointVisible({ x: 200, y: 100 }, { width: 300, height: 200 }), true);
  assert.equal(isPointVisible({ x: 600, y: 100 }, { width: 300, height: 200 }), false);
});


test('admin registration review has a direct URL', () => {
  assert.equal(readRoute('/team/admin').page, 'team');
  assert.equal(readRoute('/team/admin').teamTab, 'admin');
  assert.equal(teamPath('admin'), '/team/admin');
  assert.equal(readRoute('/team/admin').page, 'team');
});
