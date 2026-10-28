import { describe, expect, it } from 'vitest';
import { validateEditorPng } from '../../src/shared/screenshot-editor';
import { adjustSelection, emptyScene, hitTest, moveAnnotation, resizeAnnotation, annotationBounds, sceneReducer, type Annotation } from '../../src/renderer/src/capture/editor/model';

const mark: Annotation = { id: 'a', tool: 'arrow', color: '#007aff', size: 3, points: [{ x: 10, y: 10 }, { x: 100, y: 100 }] };
describe('ordinary screenshot editing', () => {
  it('undoes a moved annotation and discards redo after a different edit', () => {
    const first = sceneReducer(emptyScene, { type: 'commit', items: [mark] });
    const moved = moveAnnotation(mark, 40, -5);
    const second = sceneReducer(first, { type: 'commit', items: [moved] });
    const undone = sceneReducer(second, { type: 'undo' });
    expect(undone.items).toEqual([mark]);
    expect(sceneReducer(undone, { type: 'redo' }).items).toEqual([moved]);
    expect(sceneReducer(undone, { type: 'commit', items: [] }).redo).toEqual([]);
    expect(mark.points[0]).toEqual({ x: 10, y: 10 });
  });
  it('constrains moving and resizing to the viewport and retains a nonempty crop', () => {
    const rect = { x: 20, y: 30, width: 200, height: 100 }, viewport = { width: 1000, height: 600 };
    expect(adjustSelection(rect, 'move', -100, 700, viewport)).toEqual({ ...rect, x: 0, y: 500 });
    expect(adjustSelection(rect, 'nw', 300, 300, viewport)).toEqual({ x: 217, y: 127, width: 3, height: 3 });
    expect(adjustSelection(rect, 'se', 1000, 1000, viewport)).toEqual({ x: 20, y: 30, width: 980, height: 570 });
  });
  it('selects topmost marks and avoids hitting empty space inside an arrow bounding box', () => {
    expect(hitTest([mark], { x: 10, y: 100 })).toBeUndefined();
    expect(hitTest([mark], { x: 50, y: 50 })?.id).toBe('a');
    expect(hitTest([mark, { ...mark, id: 'b' }], { x: 50, y: 50 })?.id).toBe('b');
  });
  it('resizes reversed box corners in DIP without mutating the scene and supports undo', () => {
    const rectangle: Annotation = { ...mark, tool: 'rectangle', points: [{ x: 250, y: 180 }, { x: 150, y: 130 }] };
    const resized = resizeAnnotation(rectangle, 'se', 80, 40, { x: 100, y: 100, width: 500, height: 400 });
    expect(annotationBounds(resized)).toEqual({ x: 150, y: 130, width: 180, height: 90 });
    expect(resized.points).toEqual([{ x: 330, y: 220 }, { x: 150, y: 130 }]);
    expect(rectangle.points[0]).toEqual({ x: 250, y: 180 });
    const scene = sceneReducer(sceneReducer(emptyScene, { type: 'commit', items: [rectangle] }), { type: 'commit', items: [resized] });
    expect(sceneReducer(scene, { type: 'undo' }).items).toEqual([rectangle]);
    expect(sceneReducer(sceneReducer(scene, { type: 'undo' }), { type: 'redo' }).items).toEqual([resized]);
  });
  it('keeps all eight annotation handles within a nonzero-origin crop and avoids inversion', () => {
    const viewport = { x: 100, y: 100, width: 500, height: 400 };
    for (const tool of ['rectangle', 'ellipse', 'mosaic'] as const) {
      const box: Annotation = { ...mark, tool, points: [{ x: 150, y: 130 }, { x: 250, y: 180 }] };
      for (const handle of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
        for (const delta of [-10000, 10000]) {
          const result = annotationBounds(resizeAnnotation(box, handle, delta, delta, viewport));
          expect(result.x).toBeGreaterThanOrEqual(viewport.x); expect(result.y).toBeGreaterThanOrEqual(viewport.y);
          expect(result.width).toBeGreaterThanOrEqual(3); expect(result.height).toBeGreaterThanOrEqual(3);
          expect(result.x + result.width).toBeLessThanOrEqual(600); expect(result.y + result.height).toBeLessThanOrEqual(500);
        }
      }
    }
    expect(resizeAnnotation(mark, 'se', 100, 100, viewport)).toBe(mark);
  });
  it('rejects malformed and oversized-dimension PNG headers before decoding', () => {
    const bytes = new Uint8Array(33);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10]); bytes.set([73, 72, 68, 82], 12);
    const view = new DataView(bytes.buffer); view.setUint32(16, 500); view.setUint32(20, 300);
    expect(() => validateEditorPng(bytes, { width: 500, height: 300 })).not.toThrow();
    expect(() => validateEditorPng(bytes, { width: 500, height: 301 })).toThrow('尺寸');
    view.setUint32(16, 0xffffffff);
    expect(() => validateEditorPng(bytes, { width: 500, height: 300 })).toThrow('尺寸');
    expect(() => validateEditorPng(new Uint8Array(10), { width: 500, height: 300 })).toThrow('PNG');
  });
});
