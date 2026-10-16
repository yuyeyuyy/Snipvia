import type { ConversationSummary } from '../../../shared/contracts';
import { providerFor } from '../../../shared/providers';
import { captureDay } from '../schedule/display';
import { Temporal } from '@js-temporal/polyfill';

export function filterConversations(items: ConversationSummary[], query: string, provider: string) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(item => (provider === 'all' || item.profile.provider === provider)
    && terms.every(term => `${item.title} ${item.profile.model} ${providerFor(item.profile.provider).name}`.toLocaleLowerCase().includes(term)))
    .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
}

export function groupConversations(items: ConversationSummary[], today: string, timezone = Temporal.Now.timeZoneId()) {
  const yesterday = Temporal.PlainDate.from(today).subtract({ days: 1 }).toString();
  const groups = new Map<string, { date: string; label: string; items: ConversationSummary[] }>();
  for (const item of items) {
    const date = captureDay(item.updatedAt, timezone) ?? 'unknown';
    if (!groups.has(date)) groups.set(date, { date, label: date === today ? '今天' : date === yesterday ? '昨天' : date === 'unknown' ? '日期未知' : date.replaceAll('-', ' / '), items: [] });
    groups.get(date)!.items.push(item);
  }
  return [...groups.values()];
}

export function historyTime(instant?: string) {
  if (!instant || !Number.isFinite(Date.parse(instant))) return '';
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(instant));
}
