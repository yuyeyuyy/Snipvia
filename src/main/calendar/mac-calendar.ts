import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { MacCalendar, MacReminderList, ScheduleDraft } from '../../shared/contracts';

const runFile = promisify(execFile);
const listScript = `function run() {
  const app = Application('Calendar');
  return JSON.stringify(app.calendars().filter(c => c.writable()).map(c => ({ id: c.calendarIdentifier(), name: c.name() })));
}`;
const createScript = `function run(argv) {
  const input = JSON.parse(argv[0]);
  const app = Application('Calendar');
  const calendar = app.calendars().find(c => c.calendarIdentifier() === input.calendarId);
  if (!calendar || !calendar.writable()) throw new Error('SNIPVIA_CALENDAR_NOT_WRITABLE');
  const localDate = value => { const p = value.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2], 0, 0, 0); };
  const nextDate = value => { const date = localDate(value); date.setDate(date.getDate() + 1); return date; };
  const deadline = input.draft.kind === 'deadline';
  const start = deadline
    ? (input.draft.allDay ? localDate(input.draft.dueDate) : new Date(input.draft.dueAt))
    : (input.draft.allDay ? localDate(input.draft.startDate) : new Date(input.draft.startAt));
  const end = deadline
    ? (input.draft.allDay ? nextDate(input.draft.dueDate) : new Date(start.getTime() + 30 * 60 * 1000))
    : (input.draft.allDay ? nextDate(input.draft.endDate) : new Date(input.draft.endAt));
  const notes = [deadline ? 'Snipvia 截止事项' : '', input.draft.notes, input.draft.people.length ? '相关人物：' + input.draft.people.join('、') : ''].filter(Boolean).join('\\n\\n');
  const event = app.Event({ summary: (deadline ? '截止：' : '') + input.draft.title, startDate: start, endDate: end,
    alldayEvent: input.draft.allDay, location: input.draft.location, description: notes });
  calendar.events.push(event);
  return JSON.stringify({ id: '', calendar: { id: calendar.calendarIdentifier(), name: calendar.name() } });
}`;
const listRemindersScript = `function run() {
  const app = Application('Reminders');
  return JSON.stringify(app.lists().map(list => ({ id: list.id(), name: list.name() })));
}`;
const createReminderScript = `function run(argv) {
  const input = JSON.parse(argv[0]);
  const app = Application('Reminders');
  const list = app.lists().find(item => item.id() === input.listId);
  if (!list) throw new Error('SNIPVIA_REMINDER_LIST_NOT_FOUND');
  const localDate = value => { const p = value.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2], 9, 0, 0); };
  const deadline = input.draft.kind === 'deadline';
  const due = deadline
    ? (input.draft.allDay ? localDate(input.draft.dueDate) : new Date(input.draft.dueAt))
    : (input.draft.allDay ? localDate(input.draft.startDate) : new Date(input.draft.startAt));
  const body = [input.draft.notes, input.draft.location ? '地点：' + input.draft.location : '', input.draft.people.length ? '相关人物：' + input.draft.people.join('、') : ''].filter(Boolean).join('\\n\\n');
  const reminder = app.Reminder({ name: input.draft.title, body, dueDate: due });
  list.reminders.push(reminder);
  return JSON.stringify({ id: reminder.id(), list: { id: list.id(), name: list.name() } });
}`;

export function calendarOperationError(error: unknown, target?: '日历' | '提醒事项'): Error {
  const failure = error as { stderr?: unknown; code?: unknown; killed?: unknown; signal?: unknown } | null;
  // execFile's message contains its entire command line, including the draft.
  // Only inspect stderr and never expose unfiltered script output to the UI.
  const details = typeof failure?.stderr === 'string' ? failure.stderr.slice(0, 4096) : '';
  const application = target ?? (/Reminders|提醒事项/i.test(details) ? '提醒事项' : '日历');
  if (/SNIPVIA_CALENDAR_NOT_WRITABLE/.test(details)) {
    return new Error('所选 Mac 日历不可写或已不存在，请重新选择一个可写日历');
  }
  if (/SNIPVIA_REMINDER_LIST_NOT_FOUND/.test(details)) {
    return new Error('所选提醒事项列表已不存在，请重新选择');
  }
  if (/(?:-1743|-10004|not authorized|not permitted|access denied|permission denied|权限|拒绝访问)/i.test(details)) {
    return new Error(`未获准控制 Mac ${application}，请在“系统设置 → 隐私与安全性 → 自动化”中允许 Snipvia 控制“${application}”，然后重试`);
  }
  if (failure?.killed || failure?.signal) return new Error(`Mac ${application}响应超时；可能已经写入，请先在“${application}”检查，避免重复添加`);
  if (failure?.code === 'ENOENT') return new Error('找不到 macOS 日历脚本工具，请检查系统安装');
  if (/(?:-600|application isn.t running)/i.test(details)) return new Error(`无法启动 Mac ${application}，请先打开“${application}”再试`);
  const code = details.match(/\((-\d{2,5})\)/)?.[1];
  if (code) return new Error(`Mac ${application}脚本执行失败（错误码 ${code}）；请先在“${application}”检查是否已写入，避免重复添加`);
  if (/TypeError|SyntaxError|ReferenceError/.test(details)) {
    return new Error(`Mac ${application}脚本运行失败，请更新 Snipvia 后重试；这不代表权限已被拒绝`);
  }
  return new Error(`Mac ${application}操作失败，原因尚未确定；请先检查目标位置中是否已添加，避免重复写入`);
}

async function run(script: string, argument?: unknown, target: '日历' | '提醒事项' = '日历') {
  if (process.platform !== 'darwin') throw new Error('当前系统暂不支持写入 Mac 日历或提醒事项；可以继续保存到 Snipvia 日程');
  try {
    const args = ['-l', 'JavaScript', '-e', script];
    if (argument !== undefined) args.push('--', JSON.stringify(argument));
    const { stdout } = await runFile('/usr/bin/osascript', args, { timeout: 20_000, maxBuffer: 1024 * 1024 });
    return stdout.trim();
  } catch (error) {
    throw calendarOperationError(error, target);
  }
}

export async function listMacCalendars(): Promise<MacCalendar[]> {
  const parsed = JSON.parse(await run(listScript)) as unknown;
  if (!Array.isArray(parsed)) throw new Error('Mac 日历返回了无法识别的数据');
  return parsed.filter((item): item is MacCalendar => !!item && typeof item === 'object' && typeof (item as MacCalendar).id === 'string' && typeof (item as MacCalendar).name === 'string');
}

export async function createMacCalendarEvent(calendarId: string, draft: ScheduleDraft): Promise<{ id: string; calendar: MacCalendar }> {
  return JSON.parse(await run(createScript, { calendarId, draft })) as { id: string; calendar: MacCalendar };
}

export async function listMacReminderLists(): Promise<MacReminderList[]> {
  const parsed = JSON.parse(await run(listRemindersScript, undefined, '提醒事项')) as unknown;
  if (!Array.isArray(parsed)) throw new Error('Mac 提醒事项返回了无法识别的数据');
  return parsed.filter((item): item is MacReminderList => !!item && typeof item === 'object' &&
    typeof (item as MacReminderList).id === 'string' && typeof (item as MacReminderList).name === 'string');
}

export async function createMacReminder(listId: string, draft: ScheduleDraft): Promise<{ id: string; list: MacReminderList }> {
  return JSON.parse(await run(createReminderScript, { listId, draft }, '提醒事项')) as { id: string; list: MacReminderList };
}
