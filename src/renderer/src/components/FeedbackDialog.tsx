import { useState } from 'react';
import { Icon } from './Icon';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';

const groupNumber = '643251313';

export function FeedbackDialog({ onClose }: { onClose(): void }) {
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle');
  async function copyGroup() {
    setCopyState('copying');
    try {
      const result = await window.snipvia.notes.copyCode(groupNumber);
      if (!result.ok) throw new Error(result.error);
      setCopyState('copied');
    } catch { setCopyState('error'); }
  }
  return <Dialog label="意见反馈" className="feedback-dialog" onClose={onClose}>
    <h2>意见反馈</h2>
    <p>欢迎加入 QQ 群，反馈问题或交流建议。</p>
    <div className="feedback-group">
      <span className="feedback-group-label">QQ 群号</span>
      <div className="feedback-number"><strong>{groupNumber}</strong>
        <Button data-initial-focus aria-label="复制群号" disabled={copyState === 'copying'} onClick={() => void copyGroup()}>
          <Icon name="copy" size={14} /><span aria-live="polite">{copyState === 'copied' ? '已复制' : copyState === 'copying' ? '复制中…' : '复制群号'}</span>
        </Button>
      </div>
    </div>
    {copyState === 'error' && <p role="alert">复制失败，请重试或选中群号复制。</p>}
    <div className="feedback-actions"><Button onClick={onClose}>关闭</Button></div>
  </Dialog>;
}
