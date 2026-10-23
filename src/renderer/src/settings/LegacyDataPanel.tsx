import { useState } from 'react';
import type { LegacySnapshot } from '../../../shared/legacy';
import { Button } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';

export function LegacyDataPanel() {
  const [data, setData] = useState<LegacySnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function read() {
    setBusy(true); setMessage('');
    try { const result = await window.snipvia.legacy.read(); if (result.ok) { setData(result.value); setOpen(true); } else setMessage(result.error); }
    catch { setMessage('读取失败，原文件已保留'); }
    finally { setBusy(false); }
  }
  async function exportData() {
    setBusy(true); setMessage('');
    try { const result = await window.snipvia.legacy.export(); setMessage(result.ok ? result.value ? '旧记录已导出；外部 Markdown 请从原笔记本目录备份。' : '已取消导出' : result.error); }
    catch { setMessage('导出失败，原文件已保留'); }
    finally { setBusy(false); }
  }
  async function importImages() {
    setBusy(true); setMessage('');
    try {
      const result = await window.snipvia.legacy.importScreenshots();
      setMessage(result.ok ? '已复制 ' + result.value.imported + ' 张，已有 ' + result.value.existing + ' 张。' + result.value.errors.join(' ') : result.error);
    } catch { setMessage('导入失败，原文件已保留'); }
    finally { setBusy(false); }
  }
  return <>
    <div className="preference-row"><div className="preference-copy"><strong>旧版数据</strong><span>对话与日程只读保留；笔记仍在原文件夹，不再启动 AI 或编辑器</span></div><div className="settings-row-actions"><Button disabled={busy} onClick={() => void read()}>查看旧记录</Button><Button disabled={busy} onClick={() => void exportData()}>导出旧记录…</Button></div></div>
    <div className="preference-row"><div className="preference-copy"><strong>旧截图兼容</strong><span>按需复制到独立截图库，可重复执行；不修改原索引或图片</span></div><Button disabled={busy} onClick={() => void importImages()}>导入旧截图</Button></div>
    {message && <p role="status" className="notice">{message}</p>}
    {open && data && <Dialog label="旧版记录（只读）" className="legacy-data-dialog" onClose={() => setOpen(false)}>
      <h2>旧版记录（只读）</h2><p>保留原数据，不恢复旧工作台。长记录预览最多显示 10 万字符，完整记录请导出。</p>
      {data.errors.map(error => <p role="alert" key={error}>{error}</p>)}
      <h3>日程历史 · {data.schedule.length}</h3>{data.schedule.map(item => <details key={item.id}><summary>{item.title} · {item.createdAt}</summary><pre>{item.detail}</pre></details>)}
      <h3>对话历史 · {data.conversations.length}</h3>{data.conversations.map(item => <details key={item.id}><summary>{item.title} · {item.createdAt}</summary><pre>{item.detail}</pre></details>)}
      <h3>原笔记本 · {data.notebooks.length}</h3>{data.notebooks.map(book => <div key={book.id}><strong>{book.name}</strong><p>{book.directory}</p><Button onClick={() => { void window.snipvia.legacy.revealNotebook(book.id).then(result => { if (!result.ok) setMessage(result.error); }); }}>打开原笔记本目录</Button></div>)}
      <Button onClick={() => setOpen(false)}>关闭</Button>
    </Dialog>}
  </>;
}
