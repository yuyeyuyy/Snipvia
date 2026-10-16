import { describe, expect, it } from 'vitest';
import type { NoteEntry } from '../../src/shared/notes';
import { isVisibleNoteEntry, noteDropTarget } from '../../src/renderer/src/notes/note-drag';

const entry = (path: string, kind: NoteEntry['kind'] = 'note'): NoteEntry => ({ path, name: path.split('/').at(-1)!, kind, modifiedAt: 0, createdAt: 0, size: 0 });
const note = entry('欢迎.md'); const folder = entry('项目', 'folder'); const nested = entry('项目/子目录', 'folder');
describe('notebook tree move targets', () => {
  it('allows notes, ordinary files and folders to move into a folder or back to root', () => {
    const file = entry('report.pdf', 'asset'); const child = entry('项目/草稿', 'folder'); const entries = [note, file, folder, nested, child];
    expect(noteDropTarget(note, folder.path, entries)).toEqual({ parent: '项目', destination: '项目/欢迎.md', reason: null });
    expect(noteDropTarget(file, nested.path, entries).reason).toBeNull();
    expect(noteDropTarget(child, '', entries)).toEqual({ parent: '', destination: '草稿', reason: null });
  });
  it('rejects a folder inside itself or a descendant, duplicate names and unchanged locations', () => {
    const collision = entry('项目/欢迎.md'); const entries = [note, folder, nested, collision];
    expect(noteDropTarget(folder, folder.path, entries).reason).toBe('不能移入自身或子文件夹');
    expect(noteDropTarget(folder, nested.path, entries).reason).toBe('不能移入自身或子文件夹');
    expect(noteDropTarget(note, folder.path, entries).reason).toBe('目标目录已有同名文件或文件夹');
    expect(noteDropTarget(note, '', entries).reason).toBe('已在此目录中');
    expect(noteDropTarget(note, '已删除的目录', entries).reason).toBe('目标文件夹已不存在');
  });
  it('hides the reserved assets subtree and refuses it as a move source or target', () => {
    const assets = entry('assets', 'folder'); const image = entry('assets/image.png', 'asset'); const ordinary = entry('项目/assets', 'folder');
    const entries = [note, folder, assets, image, ordinary];
    expect(entries.filter(isVisibleNoteEntry)).toEqual([note, folder, ordinary]);
    expect(noteDropTarget(note, assets.path, entries).reason).toBe('附件目录不支持拖拽移动');
    expect(noteDropTarget(image, folder.path, entries).reason).toBe('附件目录不支持拖拽移动');
  });
});
