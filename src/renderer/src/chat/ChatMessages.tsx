import type { ReactNode } from 'react';
import type { Message } from '../../../shared/contracts';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/Icon';
import { SourceAnswer } from '../agent/SourceReferences';
import { NoteChanges } from '../agent/NoteChanges';
import { ImageAttachments } from './ImageAttachments';

export function UserMessage({ message, conversationId, onCopy, copied = false }: { message: Message; conversationId: string | null; onCopy?(): void; copied?: boolean }) {
  return <article className="workspace-message user"><header><strong>你</strong></header><div className="chat-user-bubble">{!!message.images?.length && <ImageAttachments images={message.images} conversationId={conversationId} />}<p>{message.content}</p></div>{onCopy && <footer><Button variant="quiet" onClick={onCopy} aria-label="复制消息" title="复制消息"><Icon name="copy" size={14} /><span>{copied ? '已复制' : '复制'}</span></Button></footer>}</article>;
}

export function ChatMessages({ messages, conversationId, copied, disabled, onCopy, onRegenerate, onError, renderProposals, children }: {
  messages: Message[]; conversationId: string | null; copied: number | null; disabled: boolean;
  onCopy(content: string, index: number): void; onRegenerate(): void; onError(message: string): void;
  renderProposals(ids: string[]): ReactNode; children?: ReactNode;
}) {
  return <>{messages.map((message, index) => message.role === 'user' ? <UserMessage key={index} message={message} conversationId={conversationId} copied={copied === index} onCopy={() => onCopy(message.content, index)} /> : <article className="workspace-message assistant" key={index}>
    <header><Icon name="brand" size={16} /><strong>截然</strong>{message.model && <small>{message.model}</small>}</header>
    <SourceAnswer content={message.content} sources={message.sources} richCode onError={onError} />
    {!!message.previousAnswers?.length && <details className="previous-answers"><summary>查看之前的回答（{message.previousAnswers.length}）</summary>{message.previousAnswers.map((content, version) => <SourceAnswer key={version} content={content} richCode onError={onError} />)}</details>}
    {!!message.noteChanges?.length && <NoteChanges changes={message.noteChanges} conversationId={conversationId ?? undefined} onError={onError} />}
    {renderProposals(message.editProposals?.map(proposal => proposal.id) ?? [])}
    <footer><Button variant="quiet" onClick={() => onCopy(message.content, index)}><Icon name="copy" size={14} />{copied === index ? '已复制' : '复制回答'}</Button>{index === messages.length - 1 && messages.at(-2)?.role === 'user' && <Button variant="quiet" disabled={disabled} onClick={onRegenerate}><Icon name="refresh" size={14} />重新生成</Button>}</footer>
  </article>)}{children}</>;
}
