import { useLayoutEffect, type MutableRefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { StateField, type EditorState, type Range, type RangeSet } from '@codemirror/state';
import { BlockWrapper, Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { noteLinks, proseMask, resolveNoteLink } from '../../../shared/note-markdown';
import { NotePreview } from './NotePreview';
import { codeLanguageLabel } from './code-language';

type Context = { notebookId: string; path: string; paths: string[]; onLink(target: string, wiki: boolean): void };
type PreviewState = { decorations: DecorationSet; wrappers: RangeSet<BlockWrapper> };

class WikiWidget extends WidgetType {
  constructor(readonly label: string, readonly target: string, readonly click: (target: string) => void) { super(); }
  eq(other: WikiWidget) { return other.label === this.label && other.target === this.target; }
  toDOM() {
    const button = document.createElement('button'); button.className = 'note-wiki-link'; button.textContent = this.label; button.type = 'button';
    button.addEventListener('click', () => this.click(this.target)); return button;
  }
  ignoreEvent() { return true; }
}
class ImageWidget extends WidgetType {
  constructor(readonly notebookId: string, readonly path: string) { super(); }
  eq(other: ImageWidget) { return other.notebookId === this.notebookId && other.path === this.path; }
  toDOM(view: EditorView) {
    const container = document.createElement('span'); container.className = 'note-live-image'; container.textContent = '正在加载图片…';
    void window.snipvia.notes.image(this.notebookId, this.path).then(result => {
      if (!container.isConnected) return;
      if (!result.ok || !result.value) { container.textContent = `图片无法显示：${this.path}`; return; }
      const image = document.createElement('img'); image.alt = this.path; image.src = result.value;
      image.onload = () => { if (view.dom.isConnected) view.requestMeasure(); };
      container.replaceChildren(image); view.requestMeasure();
    });
    return container;
  }
  ignoreEvent() { return false; }
}
class TaskWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly from: number) { super(); }
  eq(other: TaskWidget) { return other.checked === this.checked && other.from === this.from; }
  toDOM(view: EditorView) {
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = this.checked; input.className = 'note-live-task'; input.setAttribute('aria-label', '切换待办状态');
    input.addEventListener('change', () => view.dispatch({ changes: { from: this.from + 1, to: this.from + 2, insert: input.checked ? 'x' : ' ' } })); return input;
  }
  ignoreEvent() { return true; }
}
class CodeHeader extends WidgetType {
  constructor(readonly code: string, readonly info: string) { super(); }
  eq(other: CodeHeader) { return other.code === this.code && other.info === this.info; }
  toDOM() {
    const container = document.createElement('span'); container.className = 'note-code-heading';
    const button = document.createElement('button'), label = codeLanguageLabel(this.info); let timer: ReturnType<typeof setTimeout> | undefined;
    button.type = 'button'; button.className = 'note-code-language'; button.textContent = label;
    button.setAttribute('aria-label', `复制 ${label} 代码`); button.title = '点击语言名称复制代码';
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => {
      button.disabled = true;
      void window.snipvia.notes.copyCode(this.code).then(result => { button.textContent = result.ok ? '已复制' : '复制失败'; }).catch(() => { button.textContent = '复制失败'; }).finally(() => {
        button.disabled = false; clearTimeout(timer); timer = setTimeout(() => { if (button.isConnected) button.textContent = label; }, 1600);
      });
    });
    container.append(button); return container;
  }
  ignoreEvent() { return true; }
}
const tableRoots = new WeakMap<HTMLElement, Root>();
function TableContent({ content, context, measure }: { content: string; context: Context; measure(): void }) {
  useLayoutEffect(measure, [content]);
  return <NotePreview {...context} content={content} depth={1} />;
}
class TableWidget extends WidgetType {
  constructor(readonly content: string, readonly cells: number[][], readonly context: Context) { super(); }
  eq(other: TableWidget) { return other.content === this.content && JSON.stringify(other.cells) === JSON.stringify(this.cells) && other.context.notebookId === this.context.notebookId && other.context.path === this.context.path; }
  get estimatedHeight() { return this.cells.length * 35 + 20; }
  toDOM(view: EditorView) {
    const container = document.createElement('div'); container.className = 'note-live-table'; container.tabIndex = 0;
    container.setAttribute('aria-label', '表格预览，点击单元格编辑');
    const edit = (position: number) => { view.dispatch({ selection: { anchor: position }, effects: EditorView.scrollIntoView(position, { y: 'nearest' }) }); view.focus(); };
    container.addEventListener('mousedown', event => {
      if (event.button !== 0 || !(event.target instanceof Element) || event.target.closest('a,button,input')) return;
      const cell = event.target.closest<HTMLTableCellElement>('td,th'); if (!cell) return;
      event.preventDefault(); const row = cell.parentElement as HTMLTableRowElement;
      edit(this.cells[row.rowIndex]?.[cell.cellIndex] ?? this.cells[0][0]);
    });
    container.addEventListener('keydown', event => { if (event.key === 'Enter' && event.target === container) { event.preventDefault(); edit(this.cells[0][0]); } });
    const root = createRoot(container); tableRoots.set(container, root);
    root.render(<TableContent content={this.content} context={this.context} measure={() => { if (view.dom.isConnected) view.requestMeasure(); }} />);
    return container;
  }
  destroy(dom: HTMLElement) { const root = tableRoots.get(dom); tableRoots.delete(dom); if (root) queueMicrotask(() => root.unmount()); }
  ignoreEvent() { return true; }
}

/** Layout-affecting decorations are provided directly, before CodeMirror measures the viewport. */
export function livePreview(context: MutableRefObject<Context>) {
  function build(state: EditorState): PreviewState {
    const ranges: Range<Decoration>[] = [], wrappers: Range<BlockWrapper>[] = [], covered: Array<{ from: number; to: number }> = [];
    const selected = (from: number, to: number) => state.selection.ranges.some(range => range.from <= to && range.to >= from);
    const inCovered = (from: number, to: number) => covered.some(range => from >= range.from && to <= range.to);
    const inCode = (position: number) => {
      for (let node = syntaxTree(state).resolveInner(position, 1); node; node = node.parent!) if (['FencedCode', 'CodeBlock', 'InlineCode'].includes(node.name)) return true;
      return false;
    };
    syntaxTree(state).iterate({ enter(node) {
      const line = state.doc.lineAt(node.from);
      if (node.name === 'FencedCode') {
        const marks = node.node.getChildren('CodeMark'), closing = marks.length > 1 ? state.doc.lineAt(marks.at(-1)!.from) : null;
        const bodyFrom = Math.min(line.to + 1, state.doc.length), bodyTo = closing?.from ?? node.to;
        const code = state.doc.sliceString(bodyFrom, Math.max(bodyFrom, bodyTo)), info = node.node.getChild('CodeInfo');
        wrappers.push(BlockWrapper.create({ tagName: 'div', attributes: { class: 'note-live-code-block' } }).range(line.from, node.to));
        ranges.push(Decoration.line({ class: 'note-code-opening' }).range(line.from));
        if (!selected(line.from, line.to)) ranges.push(Decoration.replace({}).range(node.from, line.to));
        ranges.push(Decoration.widget({ widget: new CodeHeader(code, info ? state.doc.sliceString(info.from, info.to) : ''), side: 1 }).range(line.to));
        if (closing) {
          ranges.push(Decoration.line({ class: 'note-code-closing' }).range(closing.from));
          if (!selected(closing.from, closing.to)) ranges.push(Decoration.replace({}).range(closing.from, closing.to));
        }
        covered.push({ from: node.from, to: node.to }); return false;
      }
      if (node.name === 'Table' && !selected(node.from, node.to)) {
        const rows = [node.node.getChild('TableHeader'), ...node.node.getChildren('TableRow')].filter(row => !!row);
        const cells = rows.map(row => row!.getChildren('TableCell').map(cell => cell.from));
        if (cells[0]?.length) {
          ranges.push(Decoration.replace({ block: true, widget: new TableWidget(state.doc.sliceString(node.from, node.to), cells, { ...context.current, onLink: (target, wiki) => context.current.onLink(target, wiki) }) }).range(node.from, node.to));
          covered.push({ from: node.from, to: node.to }); return false;
        }
      }
      if (/^(ATXHeading|SetextHeading)[1-6]$/.test(node.name)) ranges.push(Decoration.line({ class: `note-live-h${node.name.slice(-1)}` }).range(line.from));
      if (selected(line.from, line.to)) return;
      if (['HeaderMark', 'EmphasisMark', 'StrikethroughMark', 'CodeMark'].includes(node.name)) ranges.push(Decoration.replace({}).range(node.from, node.to));
      if (node.name === 'StrongEmphasis') ranges.push(Decoration.mark({ class: 'note-live-strong' }).range(node.from, node.to));
      if (node.name === 'Emphasis') ranges.push(Decoration.mark({ class: 'note-live-em' }).range(node.from, node.to));
      if (node.name === 'InlineCode') ranges.push(Decoration.mark({ class: 'note-live-code' }).range(node.from, node.to));
    } });
    const content = state.doc.toString();
    for (const link of noteLinks(content)) {
      if (inCovered(link.from, link.to) || inCode(link.from) || selected(state.doc.lineAt(link.from).from, state.doc.lineAt(link.to).to)) continue;
      const resolved = resolveNoteLink(link.target, context.current.path, context.current.paths, link.wiki).path;
      const widget = link.embed && resolved && /\.(png|jpe?g|gif|webp)$/i.test(resolved) ? new ImageWidget(context.current.notebookId, resolved)
        : new WikiWidget(link.label ?? link.target, link.target, target => context.current.onLink(target, link.wiki));
      ranges.push(Decoration.replace({ widget }).range(link.from, link.to));
    }
    for (const match of proseMask(content).matchAll(/^(\s*(?:[-*+]|\d+\.)\s+)\[([ xX])\]/gm)) {
      const from = match.index + match[1].length;
      if (inCovered(from, from + 3) || inCode(from) || selected(state.doc.lineAt(from).from, state.doc.lineAt(from).to)) continue;
      ranges.push(Decoration.replace({ widget: new TaskWidget(match[2] !== ' ', from) }).range(from, from + 3));
    }
    return { decorations: Decoration.set(ranges, true), wrappers: BlockWrapper.set(wrappers, true) };
  }
  return StateField.define<PreviewState>({ create: build,
    update: (value, transaction) => transaction.docChanged || transaction.selection || syntaxTree(transaction.startState) !== syntaxTree(transaction.state) ? build(transaction.state) : value,
    provide: field => [EditorView.decorations.from(field, value => value.decorations), EditorView.blockWrappers.from(field, value => value.wrappers)]
  });
}
