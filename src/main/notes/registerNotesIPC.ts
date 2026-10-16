import { clipboard, dialog, shell, type BrowserWindow } from 'electron';
import { open } from 'node:fs/promises';
import { basename } from 'node:path';
import { z } from 'zod';
import { notebookIdSchema, noteNameSchema, noteFileSchema, noteSaveSchema, noteCreateSchema, noteMoveSchema, noteAssetSchema, type NotesState } from '../../shared/notes';
import type { NotebookService } from './NotebookService';

export function registerNotesIPC(handle: (channel: string, action: (value: unknown) => unknown) => void, service: NotebookService, window: () => BrowserWindow, unlinkNotebook: (id: string) => Promise<NotesState> = (id) => service.unlink(id)) {
  handle('notes:copy-code', (value) => clipboard.writeText(z.string().max(2 * 1024 * 1024).parse(value)));
  handle('notes:state', () => service.state());
  handle('notes:choose-location', async () => {
    const result = await dialog.showOpenDialog(window(), { title: '选择笔记本保存位置', buttonLabel: '使用此位置', properties: ['openDirectory', 'createDirectory'] });
    return result.canceled || !result.filePaths[0] ? null : service.chooseLocation(result.filePaths[0]);
  });
  handle('notes:create', (value) => { const input = z.strictObject({ token: z.string().uuid(), name: noteNameSchema }).parse(value); return service.create(input.token, input.name); });
  handle('notes:open', async () => {
    const result = await dialog.showOpenDialog(window(), { title: '打开已有笔记本', buttonLabel: '打开笔记本', properties: ['openDirectory'] });
    return result.canceled || !result.filePaths[0] ? null : service.open(result.filePaths[0]);
  });
  handle('notes:select', (value) => service.select(notebookIdSchema.parse(value)));
  handle('notes:unlink', (value) => unlinkNotebook(notebookIdSchema.parse(value)));
  handle('notes:entries', (value) => service.entries(notebookIdSchema.parse(value)));
  handle('notes:read', (value) => { const input = noteFileSchema.parse(value); return service.read(input.notebookId, input.path); });
  handle('notes:save', (value) => { const input = noteSaveSchema.parse(value); return service.save(input.notebookId, input); });
  handle('notes:create-entry', (value) => { const input = noteCreateSchema.parse(value); return service.createEntry(input.notebookId, input.parent, input.name, input.kind); });
  handle('notes:move', (value) => { const input = noteMoveSchema.parse(value); return service.move(input.notebookId, input.path, input.destination); });
  handle('notes:trash', (value) => { const input = noteFileSchema.parse(value); return service.trash(input.notebookId, input.path); });
  handle('notes:backlinks', (value) => { const input = noteFileSchema.parse(value); return service.backlinks(input.notebookId, input.path); });
  handle('notes:add-asset', (value) => { const input = noteAssetSchema.parse(value); return service.addAsset(input.notebookId, input.name, input.bytes); });
  handle('notes:import-assets', async (value) => {
    const id = notebookIdSchema.parse(value);
    const result = await dialog.showOpenDialog(window(), { title: '添加附件', properties: ['openFile', 'multiSelections'] });
    if (result.canceled) return [];
    if (result.filePaths.length > 20) throw new Error('每次最多添加 20 个附件');
    const files = [];
    for (const path of result.filePaths) {
      const handle = await open(path, 'r');
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size > 25 * 1024 * 1024) throw new Error('请选择普通文件，每个附件最多 25 MB');
        const bytes = Buffer.alloc(info.size + 1); let total = 0;
        while (total < bytes.length) { const { bytesRead } = await handle.read(bytes, total, bytes.length - total, total); if (!bytesRead) break; total += bytesRead; }
        if (total !== info.size) throw new Error('附件正在变化，请重试');
        files.push(await service.addAsset(id, basename(path), bytes.subarray(0, total)));
      } finally { await handle.close(); }
    }
    return files;
  });
  handle('notes:image', (value) => { const input = noteFileSchema.parse(value); return service.image(input.notebookId, input.path); });
  handle('notes:reveal', async (value) => { const input = noteFileSchema.parse(value); shell.showItemInFolder(await service.revealPath(input.notebookId, input.path)); });
  handle('notes:export', async (value) => {
    const id = notebookIdSchema.parse(value); const book = (await service.state()).notebooks.find((item) => item.id === id);
    if (!book) throw new Error('笔记本尚未授权');
    const result = await dialog.showSaveDialog(window(), { title: '打包导出笔记本', defaultPath: `${book.name}.zip`, filters: [{ name: 'ZIP 笔记本', extensions: ['zip'] }] });
    return result.canceled || !result.filePath ? null : service.export(id, result.filePath);
  });
}
