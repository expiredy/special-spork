import { MousePointer2 } from 'lucide-react';
import { flowToScreenPoint, isPointVisible } from '../lib/cursorCoordinates.js';

/** Render remote pointers in the local viewport while retaining their graph-space position. */
export function RemoteCursors({ cursors = {}, viewport, width = 0, height = 0 }) {
  const canvasSize = { width, height };

  return Object.entries(cursors).map(([clientId, cursor]) => {
    const point = cursor.coordinateSpace === 'flow'
      ? flowToScreenPoint(cursor, viewport)
      : { x: cursor.x * width, y: cursor.y * height };
    if (!isPointVisible(point, canvasSize)) return null;

    return (
      <div
        className="remote-cursor"
        key={clientId}
        style={{ left: `${point.x}px`, top: `${point.y}px`, '--cursor-color': cursor.color || '#86d6ff' }}
        aria-label={`Курсор пользователя ${cursor.user || clientId}`}
      >
        <MousePointer2 size={18} fill={cursor.color || '#86d6ff'} />
        <span>{cursor.user || clientId}</span>
      </div>
    );
  });
}

export default RemoteCursors;
