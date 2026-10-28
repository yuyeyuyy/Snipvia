import { useEffect, useLayoutEffect, useReducer, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Selection } from '../../../../shared/contracts';
import type { EditorAction } from '../../../../shared/screenshot-editor';
import { adjustSelection, annotationBounds, contains, emptyScene, hitTest, moveAnnotation, resizeAnnotation, sceneReducer, type Annotation, type EditorTool, type Point } from './model';
import { drawAnnotations, renderEditedPng } from './draw';
import { EditorIcon, type EditorIconName } from './EditorIcon';

const tools: Array<{ id: EditorTool; label: string; key: string }> = [
  { id: 'select', label: '选择与移动', key: 'V' }, { id: 'rectangle', label: '矩形', key: 'R' },
  { id: 'ellipse', label: '椭圆', key: 'E' }, { id: 'arrow', label: '箭头', key: 'A' },
  { id: 'pencil', label: '铅笔', key: 'P' }, { id: 'text', label: '文字', key: 'T' },
  { id: 'number', label: '序号', key: 'N' }, { id: 'mosaic', label: '打码', key: 'M' }, { id: 'erase', label: '删除标注', key: 'D' }
];
const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const colors = ['#ff453a', '#007aff', '#30b04a', '#ffcc00', '#ffffff', '#000000'];
type Gesture = { start: Point; rect: Selection; handle?: string; item?: Annotation; moving?: boolean; annotationHandle?: string };

export function ScreenshotEditor({ frame, initialSelection, sessionId }: { frame: string; initialSelection: Selection; sessionId: string }) {
  const [selection, setSelection] = useState(initialSelection);
  const [scene, dispatch] = useReducer(sceneReducer, emptyScene);
  const [tool, setTool] = useState<EditorTool>('select');
  const [color, setColor] = useState(colors[0]);
  const [size, setSize] = useState(3);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Annotation | null>(null);
  const [text, setText] = useState<Annotation | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toolbarPosition, setToolbarPosition] = useState<Point | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const finishing = useRef(false);
  const mounted = useRef(true);
  const toolbarDrag = useRef<{ start: Point; position: Point } | null>(null);
  const textInput = useRef<HTMLTextAreaElement>(null);
  const selected = scene.items.find((item) => item.id === selectedId);
  const selectedBox = selected && !text && ['rectangle', 'ellipse', 'mosaic'].includes(selected.tool) ? annotationBounds(draft?.id === selected.id ? draft : selected) : null;
  const toolbarWidth = Math.min(760, innerWidth - 24);
  const toolbar = toolbarPosition ?? {
    x: Math.max(12, Math.min(innerWidth - toolbarWidth - 12, selection.x + selection.width - toolbarWidth)),
    y: selection.y + selection.height + 120 < innerHeight ? selection.y + selection.height + 14 : Math.max(12, selection.y - 114)
  };

  useEffect(() => {
    mounted.current = true;
    const img = new Image();
    img.onload = () => setImage(img); img.src = frame;
    return () => { mounted.current = false; img.onload = null; };
  }, [frame]);

  useLayoutEffect(() => {
    const target = canvas.current;
    if (!target || !image) return;
    const ratio = Math.min(devicePixelRatio, 2);
    target.width = Math.ceil(selection.width * ratio); target.height = Math.ceil(selection.height * ratio);
    const ctx = target.getContext('2d')!;
    ctx.setTransform(ratio, 0, 0, ratio, -selection.x * ratio, -selection.y * ratio);
    ctx.drawImage(image, 0, 0, innerWidth, innerHeight);
    const items = scene.items.filter((item) => item.id !== text?.id && item.id !== draft?.id);
    drawAnnotations(ctx, draft ? [...items, draft] : items);
    const marked = draft?.id === selectedId ? draft : selected;
    if (marked) {
      const box = annotationBounds(marked);
      // Preview-only selection chrome; exported annotation pixels keep their chosen colors.
      const chrome = getComputedStyle(target);
      ctx.strokeStyle = chrome.getPropertyValue('--capture-selection-shadow').trim(); ctx.lineWidth = 3; ctx.setLineDash([4, 4]);
      ctx.strokeRect(box.x - 5, box.y - 5, box.width + 10, box.height + 10);
      ctx.strokeStyle = chrome.getPropertyValue('--capture-editor-selection').trim(); ctx.lineWidth = 1;
      ctx.strokeRect(box.x - 5, box.y - 5, box.width + 10, box.height + 10);
    }
  }, [image, selection, scene.items, draft, selected, selectedId, text?.id]);

  function commitText(): Annotation[] {
    if (!text) return scene.items;
    const original = scene.items.find(item => item.id === text.id);
    const unchanged = original && original.text === text.text && original.color === text.color && original.size === text.size;
    const items = unchanged || (!original && !text.text?.trim()) ? scene.items
      : original ? scene.items.flatMap(item => item.id === text.id ? text.text?.trim() ? [text] : [] : [item])
      : [...scene.items, text];
    if (items !== scene.items) dispatch({ type: 'commit', items });
    setText(null);
    return items;
  }
  function editText(item: Annotation) {
    setText(item); setSelectedId(item.id); setColor(item.color); setSize(item.size);
    requestAnimationFrame(() => { textInput.current?.focus(); textInput.current?.select(); });
  }
  function chooseTool(next: EditorTool) {
    commitText(); setTool(next); setSelectedId(null); setError('');
  }
  function changeStyle(update: { color?: string; size?: number }) {
    if (update.color) setColor(update.color);
    if (update.size) setSize(update.size);
    if (text) setText({ ...text, ...update });
    else if (selected) dispatch({ type: 'commit', items: scene.items.map((item) => item.id === selected.id ? { ...item, ...update } : item) });
  }
  async function finish(action: EditorAction) {
    if (finishing.current) return;
    finishing.current = true; setBusy(true); setError('');
    const items = commitText();
    try {
      const crop = await window.snipvia.capture.editorCrop({ sessionId, selection });
      if (!crop.ok) throw new Error(crop.error);
      const png = items.length ? await renderEditedPng(crop.value, items) : crop.value.bytes;
      if (!mounted.current) return;
      const result = await window.snipvia.capture.editorFinish({ sessionId, selection, action, png });
      if (!result.ok) throw new Error(result.error);
    } catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : '无法完成截图'); }
    finally { if (mounted.current) { finishing.current = false; setBusy(false); } }
  }

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return;
      if (busy) { event.preventDefault(); return; }
      const modifier = event.metaKey || event.ctrlKey;
      const lower = event.key.toLowerCase();
      if (modifier && ['c', 's', 'z', 'y'].includes(lower)) {
        event.preventDefault();
        if (lower === 'c') void finish('copy');
        else if (lower === 's') void finish('save');
        else { setSelectedId(null); dispatch({ type: lower === 'y' || event.shiftKey ? 'redo' : 'undo' }); }
      } else if (event.key === 'Escape') { event.preventDefault(); void window.snipvia.capture.cancel(); }
      else if (event.key === 'Enter') { event.preventDefault(); void finish('copy'); }
      else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) {
        event.preventDefault(); dispatch({ type: 'commit', items: scene.items.filter((item) => item.id !== selectedId) }); setSelectedId(null);
      } else if (!modifier && !event.altKey) {
        const next = tools.find((item) => item.key.toLowerCase() === lower);
        if (next) { event.preventDefault(); chooseTool(next.id); }
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  function point(event: ReactPointerEvent): Point { return { x: Math.max(selection.x, Math.min(selection.x + selection.width, event.clientX)), y: Math.max(selection.y, Math.min(selection.y + selection.height, event.clientY)) }; }
  function start(event: ReactPointerEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (busy || event.button !== 0) return;
    const p = point(event);
    const target = event.target as HTMLElement;
    const handle = target.closest<HTMLElement>('[data-handle]')?.dataset.handle;
    const annotationHandle = target.closest<HTMLElement>('[data-annotation-handle]')?.dataset.annotationHandle;
    if (!handle && !contains(selection, { x: event.clientX, y: event.clientY })) return;
    const items = commitText();
    if (annotationHandle && selected) {
      event.currentTarget.setPointerCapture(event.pointerId);
      gesture.current = { start: p, rect: selection, item: selected, annotationHandle }; return;
    }
    if (handle) { event.currentTarget.setPointerCapture(event.pointerId); gesture.current = { start: { x: event.clientX, y: event.clientY }, rect: selection, handle }; return; }
    const hit = hitTest(items, p);
    if (tool === 'erase') { if (hit) dispatch({ type: 'commit', items: items.filter((item) => item.id !== hit.id) }); setSelectedId(null); return; }
    if (tool === 'text' && hit?.tool === 'text') { editText(hit); return; }
    if (tool === 'select') {
      event.currentTarget.setPointerCapture(event.pointerId);
      setSelectedId(hit?.id ?? null);
      if (hit) { setColor(hit.color); setSize(hit.size); }
      gesture.current = hit ? { start: p, rect: selection, item: hit, moving: true } : { start: p, rect: selection, handle: 'move' };
      return;
    }
    const item: Annotation = { id: crypto.randomUUID(), tool, color, size, points: [p] };
    setSelectedId(null);
    if (tool === 'text') { editText({ ...item, text: '' }); return; }
    if (tool === 'number') {
      item.number = Math.max(0, ...items.filter((mark) => mark.tool === 'number').map((mark) => mark.number ?? 0)) + 1;
      dispatch({ type: 'commit', items: [...items, item] }); return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { start: p, rect: selection, item }; setDraft(item);
  }
  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current) return;
    if (current.handle) {
      setSelection(adjustSelection(current.rect, current.handle, event.clientX - current.start.x, event.clientY - current.start.y, { width: innerWidth, height: innerHeight }));
    } else if (current.item) {
      const p = point(event);
      if (current.annotationHandle) setDraft(resizeAnnotation(current.item, current.annotationHandle, p.x - current.start.x, p.y - current.start.y, current.rect));
      else if (current.moving) setDraft(moveAnnotation(current.item, p.x - current.start.x, p.y - current.start.y));
      else {
        const points = current.item.tool === 'pencil' ? [...current.item.points, p] : [current.start, p];
        // Bound path size without recording mouse moves in IPC or performance logs.
        if (points.length > 12000) return;
        current.item = { ...current.item, points }; setDraft(current.item);
      }
    }
  }
  function end(event: ReactPointerEvent<HTMLDivElement>) {
    const current = gesture.current; gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (current?.handle) setSelection(adjustSelection(current.rect, current.handle, event.clientX - current.start.x, event.clientY - current.start.y, { width: innerWidth, height: innerHeight }));
    if (current?.item) {
      // Commit from the pointer gesture, not the last React paint: pointerup can arrive before a render.
      const p = point(event);
      const completed = current.annotationHandle ? resizeAnnotation(current.item, current.annotationHandle, p.x - current.start.x, p.y - current.start.y, current.rect) : current.moving ? moveAnnotation(current.item, p.x - current.start.x, p.y - current.start.y)
        : current.item.tool === 'pencil' ? current.item : { ...current.item, points: [current.start, p] };
      const bounds = annotationBounds(completed);
      const transformed = current.moving || current.annotationHandle;
      const changed = Math.hypot(p.x - current.start.x, p.y - current.start.y) >= 1;
      if (transformed ? changed : completed.tool === 'pencil' || bounds.width >= 2 || bounds.height >= 2) {
        dispatch({ type: 'commit', items: transformed ? scene.items.map((item) => item.id === completed.id ? completed : item) : [...scene.items, completed] });
      }
    }
    setDraft(null);
  }
  function button(icon: EditorIconName, label: string, onClick: () => void, disabled = false) {
    return <button type="button" title={label} aria-label={label} disabled={busy || disabled} onClick={onClick}><EditorIcon name={icon} /></button>;
  }

  return <div className={`screenshot-editor tool-${tool}`} data-testid="screenshot-editor" onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={() => { gesture.current = null; setDraft(null); }} onDoubleClick={(event) => {
      if (busy || (event.target as HTMLElement).closest('.editor-toolbar, .editor-text')) return;
      const hit = hitTest(scene.items, { x: event.clientX, y: event.clientY });
      if (hit?.tool === 'text') editText(hit);
    }} onContextMenu={(e) => { e.preventDefault(); chooseTool('select'); }}>
    <canvas ref={canvas} className="editor-preview" style={{ left: selection.x, top: selection.y, width: selection.width, height: selection.height }} />
    <div className="editor-selection" style={{ left: selection.x, top: selection.y, width: selection.width, height: selection.height }}>
      <span className="editor-dimensions" style={{ top: selection.y < 34 ? 10 : -32 }}>{Math.round(selection.width)} × {Math.round(selection.height)} <small>DIP</small></span>
      {['n', 'e', 's', 'w'].map(handle => <div key={handle} data-handle={handle} className={'editor-resize-edge edge-' + handle} />)}
      {handles.map(handle => <div key={handle} data-handle={handle} className={'editor-handle handle-' + handle} aria-label={'调整选区 ' + handle} />)}
    </div>
    {selectedBox && <div className="editor-annotation-selection" style={{ left: selectedBox.x, top: selectedBox.y, width: selectedBox.width, height: selectedBox.height }}>
      {handles.map(handle => <div key={handle} data-annotation-handle={handle} className={'editor-handle handle-' + handle} aria-label={'调整标注 ' + handle} />)}
    </div>}
    {text && <textarea ref={textInput} className="editor-text" aria-label="标注文字" value={text.text ?? ''} maxLength={4000} placeholder="输入文字" style={{ left: text.points[0].x, top: text.points[0].y, color: text.color, fontSize: text.size * 6 + 12, maxWidth: Math.max(80, innerWidth - text.points[0].x - 12), maxHeight: Math.max(50, innerHeight - text.points[0].y - 12) }} onPointerDown={(event) => event.stopPropagation()} onChange={(event) => setText({ ...text, text: event.target.value })} onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); setText(null); }
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); commitText(); }
    }} />}
    <div className="editor-toolbar" role="toolbar" aria-label="截图标注工具栏" style={{ left: toolbar.x, top: toolbar.y, width: toolbarWidth }} onPointerDown={(event) => event.stopPropagation()}>
      <div className="editor-tool-row">
        <span className="editor-grip" title="拖动工具栏" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); toolbarDrag.current = { start: { x: event.clientX, y: event.clientY }, position: toolbar }; }} onPointerMove={(event) => {
          const drag = toolbarDrag.current;
          if (drag) setToolbarPosition({ x: Math.max(12, Math.min(innerWidth - toolbarWidth - 12, drag.position.x + event.clientX - drag.start.x)), y: Math.max(12, Math.min(innerHeight - 108, drag.position.y + event.clientY - drag.start.y)) });
        }} onPointerUp={() => { toolbarDrag.current = null; }}>⠿</span>
        {tools.map((item) => <button key={item.id} type="button" title={`${item.label} (${item.key})`} aria-label={item.label} aria-pressed={tool === item.id} disabled={busy} onClick={() => chooseTool(item.id)}><EditorIcon name={item.id} /></button>)}
        <span className="editor-divider" />
        {button('undo', '撤销', () => { commitText(); setSelectedId(null); dispatch({ type: 'undo' }); }, !scene.undo.length && !text)}
        {button('redo', '重做', () => { setSelectedId(null); dispatch({ type: 'redo' }); }, !scene.redo.length || !!text)}
        <span className="editor-divider" />
        {button('pin', '定住截图', () => { void finish('pin'); })}
        {button('save', '保存图片', () => { void finish('save'); })}
        {button('close', '取消截图', () => { void window.snipvia.capture.cancel(); })}
        {button('copy', '复制并关闭', () => { void finish('copy'); })}
      </div>
      <div className="editor-options">
        <div className="editor-colors" aria-label="标注颜色">{colors.map((value) => <button type="button" key={value} aria-label={`颜色 ${value}`} aria-pressed={(text?.color ?? selected?.color ?? color) === value} disabled={busy} style={{ '--swatch': value } as React.CSSProperties} onClick={() => changeStyle({ color: value })} />)}</div>
        <label>粗细 <select aria-label="标注粗细" value={text?.size ?? selected?.size ?? size} disabled={busy} onChange={(event) => changeStyle({ size: Number(event.target.value) })}><option value={2}>细</option><option value={3}>标准</option><option value={5}>粗</option><option value={8}>特粗</option></select></label>
        <span className="editor-help">{busy ? '正在完成截图…' : tool === 'text' ? '单击添加 · 双击修改 · Shift Enter 换行' : tool === 'select' ? '拖动选区或标注 · 拖拽圆点调整大小' : tool === 'erase' ? '点击删除一条标注' : 'Enter 复制 · Esc 取消'}</span>
      </div>
      {error && <div className="editor-error" role="alert">{error}</div>}
    </div>
  </div>;
}
