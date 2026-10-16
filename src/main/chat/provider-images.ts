import type { Message } from '../../shared/contracts';
import { chatImageLimits, type ChatImage } from '../../shared/chat-images';
import type { CapabilityStatus } from '../../shared/models';
import type { AgentImages } from '../ai/llm/ChatCompletionsAgentProvider';

/** Only Main supplies references. Earlier image turns remain attached to their own user message. */
export function providerImages(current: ChatImage[], messages: Message[], vision: CapabilityStatus, read: (image: ChatImage) => Buffer): { images: AgentImages; notice?: string } {
  if (vision === 'unsupported' && current.length) throw new Error('当前模型已确认不支持图片输入，请更换视觉模型或移除图片后发送文本');
  const images: AgentImages = { current: [], history: new Map() }; const history = images.history as Map<string, string>;
  if (vision === 'unsupported') return { images, notice: messages.some(message => message.images?.length) ? '当前模型不支持图片，本次仅发送文本，历史图片不会上传。' : undefined };
  let bytes = 0, count = 0, omitted = 0;
  for (const image of current) { const buffer = read(image); bytes += buffer.byteLength; count++; if (bytes > chatImageLimits.requestBytes || count > chatImageLimits.requestImages) throw new Error('本次图片总量超过限制，请减少图片'); images.current.push(`data:image/png;base64,${buffer.toString('base64')}`); }
  for (const message of [...messages].reverse()) if (message.role === 'user') for (const image of [...(message.images ?? [])].reverse()) {
    if (history.has(image.id)) continue;
    if (count >= chatImageLimits.requestImages || bytes + image.bytes > chatImageLimits.requestBytes) { omitted++; continue; }
    try { const buffer = read(image); bytes += buffer.byteLength; count++; history.set(image.id, `data:image/png;base64,${buffer.toString('base64')}`); }
    catch { omitted++; }
  }
  return { images, ...(omitted ? { notice: '部分较早或已缺失的图片未随本轮发送；需要其中内容时请重新添加。' } : {}) };
}
