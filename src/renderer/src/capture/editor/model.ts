import type { Selection } from '../../../../shared/contracts';

export type Point = { x: number; y: number };
export type DrawTool = 'rectangle' | 'ellipse' | 'arrow' | 'pencil' | 'text' | 'number' | 'mosaic';
export type EditorTool = DrawTool | 'select' | 'erase';
export type Annotation = {
  id: string; tool: DrawTool; points: Point[]; color: string; size: number; text?: string; number?: number;
};
export type Scene = { items: Annotation[]; undo: Annotation[][]; redo: Annotation[][] };
export type SceneAction = { type: 'commit'; items: Annotation[] } | { type: 'undo' | 'redo' };
export const emptyScene: Scene = { items: [], undo: [], redo: [] };
export function sceneReducer(state: Scene, action: SceneAction): Scene {
  if (action.type === 'commit') return { items: action.items, undo: [...state.undo.slice(-79), state.items], redo: [] };
  if (action.type === 'undo' && state.undo.length) return {
    items: state.undo.at(-1)!, undo: state.undo.slice(0, -1), redo: [...state.redo, state.items]
  };
  if (action.type === 'redo' && state.redo.length) return {
    items: state.redo.at(-1)!, undo: [...state.undo, state.items], redo: state.redo.slice(0, -1)
  };
  return state;
}
export function pointRect(a: Point, b: Point): Selection {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}
export function annotationBounds(item: Annotation): Selection {
  const a = item.points[0];
  if (item.tool === 'text') {
    const lines = (item.text ?? '').split('\n');
    const font = item.size * 6 + 12;
    return { x: a.x, y: a.y, width: Math.max(font, ...lines.map((line) => [...line].reduce((w, char) => w + font * (char.charCodeAt(0) > 255 ? 1 : 0.65), 0))), height: lines.length * font * 1.3 };
  }
  if (item.tool === 'number') {
    const r = item.size * 2 + 10;
    return { x: a.x - r, y: a.y - r, width: r * 2, height: r * 2 };
  }
  const xs = item.points.map((point) => point.x), ys = item.points.map((point) => point.y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}
export function contains(rect: Selection, p: Point, padding = 0) {
  return p.x >= rect.x - padding && p.x <= rect.x + rect.width + padding && p.y >= rect.y - padding && p.y <= rect.y + rect.height + padding;
}
export function hitTest(items: Annotation[], p: Point): Annotation | undefined {
  return [...items].reverse().find((item) => {
    if (!contains(annotationBounds(item), p, 7)) return false;
    if (item.tool === 'pencil' || item.tool === 'arrow') {
      return item.points.some((b, index) => {
        const a = item.points[Math.max(0, index - 1)];
        const dx = b.x - a.x, dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
        return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy) <= item.size + 7;
      });
    }
    return true;
  });
}
export function moveAnnotation(item: Annotation, dx: number, dy: number): Annotation {
  return { ...item, points: item.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
}
export function adjustSelection(rect: Selection, handle: string, dx: number, dy: number, viewport: { width: number; height: number }): Selection {
  if (handle === 'move') return { ...rect, x: Math.max(0, Math.min(viewport.width - rect.width, rect.x + dx)), y: Math.max(0, Math.min(viewport.height - rect.height, rect.y + dy)) };
  let { x, y, width, height } = rect;
  const right = x + width, bottom = y + height;
  if (handle.includes('w')) { x = Math.max(0, Math.min(right - 3, x + dx)); width = right - x; }
  if (handle.includes('n')) { y = Math.max(0, Math.min(bottom - 3, y + dy)); height = bottom - y; }
  if (handle.includes('e')) width = Math.max(3, Math.min(viewport.width - x, width + dx));
  if (handle.includes('s')) height = Math.max(3, Math.min(viewport.height - y, height + dy));
  return { x, y, width, height };
}

/** Resize box annotations in screen DIP; retain corner orientation and the source object. */
export function resizeAnnotation(item: Annotation, handle: string, dx: number, dy: number, viewport: Selection): Annotation {
  if (!['rectangle', 'ellipse', 'mosaic'].includes(item.tool)) return item;
  const before = annotationBounds(item);
  if (!before.width || !before.height) return item;
  const local = { ...before, x: before.x - viewport.x, y: before.y - viewport.y };
  const after = adjustSelection(local, handle, dx, dy, viewport);
  return { ...item, points: item.points.map(point => ({
    x: viewport.x + after.x + (point.x - before.x) / before.width * after.width,
    y: viewport.y + after.y + (point.y - before.y) / before.height * after.height
  })) };
}
