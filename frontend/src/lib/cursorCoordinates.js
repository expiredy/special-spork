/** Coordinate transforms for remote pointers on a zoomable React Flow canvas.
 * Remote cursors are stored in flow-space so each collaborator can view them at
 * the same graph location even when their local pan/zoom is different.
 */

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function screenToFlowPoint(point, viewport) {
  const zoom = Math.max(0.01, finite(viewport?.zoom, 1));
  return {
    x: (finite(point?.x) - finite(viewport?.x)) / zoom,
    y: (finite(point?.y) - finite(viewport?.y)) / zoom,
  };
}

export function flowToScreenPoint(point, viewport) {
  const zoom = Math.max(0.01, finite(viewport?.zoom, 1));
  return {
    x: finite(point?.x) * zoom + finite(viewport?.x),
    y: finite(point?.y) * zoom + finite(viewport?.y),
  };
}

export function isPointVisible(point, size, padding = 24) {
  return point.x >= -padding && point.y >= -padding
    && point.x <= finite(size?.width) + padding
    && point.y <= finite(size?.height) + padding;
}
