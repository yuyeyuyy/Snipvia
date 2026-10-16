import { useEffect, useMemo, useRef, useState } from 'react';
import { Temporal } from '@js-temporal/polyfill';
import type { MacCalendar, MacReminderList, ModelProfile, ScheduleDraft, ScheduleEvent, ScheduleJob, ScheduleJobSummary } from '../../../shared/contracts';
import { providerFor } from '../../../shared/providers';
import { eventDateRange, monthWeeks, type CalendarEntry } from '../../../shared/schedule-calendar';
import { instantToLocalInput, localInputToInstant } from '../../../shared/schedule-time';
import { Icon } from '../components/Icon';
import { WorkspaceHeader } from '../components/WorkspaceHeader';
import { Button, IconButton } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadingState } from '../components/ui/LoadingState';
import { capturesForDate, entriesForDate, eventTimeLabel, eventSpanLabel, moveMonth } from './display';
import './schedule.css';

function EventEditor({ jobId, event, onUpdated, onError }: {
  jobId: string; event: ScheduleEvent; onUpdated(value: ScheduleJob): void; onError(error: string): void;
}) {
  const macIntegrationsAvailable = window.snipvia.platform === 'darwin';
  const [draft, setDraft] = useState<ScheduleDraft>(event);
  const [calendars, setCalendars] = useState<MacCalendar[]>([]);
  const [calendarId, setCalendarId] = useState('');
  const [reminderLists, setReminderLists] = useState<MacReminderList[]>([]);
  const [reminderListId, setReminderListId] = useState('');
  const [systemTarget, setSystemTarget] = useState<'calendar' | 'reminders'>(event.kind === 'deadline' ? 'reminders' : 'calendar');
  const [busy, setBusy] = useState<'local' | 'calendars' | 'reminders' | 'mac' | ''>('');
  const [status, setStatus] = useState('');
  useEffect(() => { setDraft(event); setSystemTarget(event.kind === 'deadline' ? 'reminders' : 'calendar'); setStatus(''); }, [event.id]);
  function update(value: Partial<ScheduleDraft>) { setDraft((current) => ({ ...current, ...value })); setStatus(''); }
  function updateTime(field: 'startAt' | 'endAt' | 'dueAt', value: string) {
    try { update({ [field]: localInputToInstant(value, draft.timezone) }); }
    catch { onError('该时间在所选时区中不存在或有两种可能，请调整时间后重试'); }
  }
  function changeKind(kind: ScheduleDraft['kind']) {
    if (kind === draft.kind) return;
    if (kind === 'deadline') {
      update({ kind, dueAt: draft.dueAt ?? draft.endAt, dueDate: draft.dueDate ?? draft.endDate,
        startAt: null, endAt: null, startDate: null, endDate: null,
        unresolvedFields: draft.unresolvedFields.filter((item) => !/(开始|结束|时长)/.test(item)),
        warnings: draft.warnings.filter((item) => !/(开始|结束|时长)/.test(item)) });
      return;
    }
    const startAt = draft.startAt ?? draft.dueAt;
    const endAt = draft.endAt ?? (startAt ? new Date(Date.parse(startAt) + 60 * 60 * 1000).toISOString() : null);
    update({ kind, startAt, endAt, startDate: draft.startDate ?? draft.dueDate, endDate: draft.endDate ?? draft.dueDate,
      dueAt: null, dueDate: null });
  }
  function changeAllDay(allDay: boolean) {
    if (draft.kind === 'deadline') update({ allDay, ...(allDay ? { dueAt: null } : { dueDate: null }) });
    else update({ allDay, ...(allDay ? { startAt: null, endAt: null } : { startDate: null, endDate: null }) });
  }
  async function saveLocal() {
    setBusy('local'); setStatus('');
    const result = await window.snipvia.schedule.save({ jobId, eventId: event.id, draft });
    if (result.ok) { onUpdated(result.value); setStatus('已保存到截然日程'); } else onError(result.error);
    setBusy('');
  }
  async function loadCalendars() {
    setBusy('calendars'); setStatus('');
    const result = await window.snipvia.schedule.macCalendars();
    if (result.ok) {
      setCalendars(result.value); setCalendarId(result.value[0]?.id ?? '');
      if (!result.value.length) onError('没有找到可写的 Mac 日历');
    } else onError(result.error);
    setBusy('');
  }
  async function saveMac() {
    if (!calendarId) return;
    setBusy('mac'); setStatus('');
    const result = await window.snipvia.schedule.saveToMac({ jobId, eventId: event.id, calendarId, draft });
    if (result.ok) { onUpdated(result.value); setStatus('已添加到 Mac 日历'); } else onError(result.error);
    setBusy('');
  }
  async function loadReminderLists() {
    setBusy('reminders'); setStatus('');
    const result = await window.snipvia.schedule.macReminderLists();
    if (result.ok) {
      setReminderLists(result.value); setReminderListId(result.value[0]?.id ?? '');
      if (!result.value.length) onError('没有找到可写的提醒事项列表');
    } else onError(result.error);
    setBusy('');
  }
  async function saveReminder() {
    if (!reminderListId) return;
    setBusy('mac'); setStatus('');
    const result = await window.snipvia.schedule.saveToReminders({ jobId, eventId: event.id, listId: reminderListId, draft });
    if (result.ok) { onUpdated(result.value); setStatus('已添加到 Mac 提醒事项'); } else onError(result.error);
    setBusy('');
  }
  return <section className="schedule-editor">
    <div className="schedule-editor-title"><strong>{draft.kind === 'deadline' ? '候选截止事项' : '候选时间段事件'}</strong>{event.savedLocal && <span>已存截然</span>}{event.macCalendar && <span>日历 · {event.macCalendar.name}</span>}{event.macReminder && <span>提醒事项 · {event.macReminder.name}</span>}</div>
    <label>记录类型<select aria-label="记录类型" value={draft.kind} onChange={(e) => changeKind(e.target.value as ScheduleDraft['kind'])}><option value="event">时间段事件</option><option value="deadline">截止事项</option></select><small>{draft.kind === 'deadline' ? '用于“某日前完成、最晚提交”等只有截止点的事项。' : '用于会议、预约、行程等有开始和结束的安排。'}</small></label>
    <label>标题<input aria-label="日程标题" value={draft.title} onChange={(e) => update({ title: e.target.value })} /></label>
    <label className="check"><input type="checkbox" checked={draft.allDay} onChange={(e) => changeAllDay(e.target.checked)} />{draft.kind === 'deadline' ? '只精确到日期' : '全天日程'}</label>
    <div className="schedule-grid">
      {draft.kind === 'deadline' ? (draft.allDay
        ? <label>截止日期<input aria-label="截止日期" type="date" value={draft.dueDate ?? ''} onChange={(e) => update({ dueDate: e.target.value || null })} /></label>
        : <label>截止时间<input aria-label="截止时间" type="datetime-local" value={instantToLocalInput(draft.dueAt, draft.timezone)} onChange={(e) => updateTime('dueAt', e.target.value)} /></label>)
        : draft.allDay ? <>
        <label>开始日期<input aria-label="开始日期" type="date" value={draft.startDate ?? ''} onChange={(e) => update({ startDate: e.target.value || null })} /></label>
        <label>结束日期（含）<input aria-label="结束日期" type="date" value={draft.endDate ?? ''} onChange={(e) => update({ endDate: e.target.value || null })} /></label>
      </> : <>
        <label>开始时间<input aria-label="开始时间" type="datetime-local" value={instantToLocalInput(draft.startAt, draft.timezone)} onChange={(e) => updateTime('startAt', e.target.value)} /></label>
        <label>结束时间<input aria-label="结束时间" type="datetime-local" value={instantToLocalInput(draft.endAt, draft.timezone)} onChange={(e) => updateTime('endAt', e.target.value)} /></label>
      </>}
      <label>时区<input aria-label="时区" value={draft.timezone} onChange={(e) => update({ timezone: e.target.value })} /></label>
      <label>地点<input aria-label="地点" value={draft.location} onChange={(e) => update({ location: e.target.value })} /></label>
    </div>
    <label>人物<input aria-label="相关人物" value={draft.people.join('，')} onChange={(e) => update({ people: e.target.value.split(/[，,]/).map((item) => item.trim()).filter(Boolean) })} placeholder="例如：张三，李四" /></label>
    <label>备注<textarea aria-label="日程备注" className="schedule-notes" value={draft.notes} onChange={(e) => update({ notes: e.target.value })} /></label>
    {(draft.unresolvedFields.length > 0 || draft.warnings.length > 0) && <div className="schedule-review" role="note">
      {draft.unresolvedFields.length > 0 && <p><strong>请补充：</strong>{draft.unresolvedFields.join('、')}</p>}
      {draft.warnings.length > 0 && <p><strong>请核对：</strong>{draft.warnings.join('；')}</p>}
    </div>}
    {macIntegrationsAvailable && <><div className="schedule-system-target" role="group" aria-label="写入 Mac 应用">
      <button type="button" className={systemTarget === 'calendar' ? 'active' : ''} onClick={() => { setSystemTarget('calendar'); setStatus(''); }}>日历</button>
      <button type="button" className={systemTarget === 'reminders' ? 'active' : ''} onClick={() => { setSystemTarget('reminders'); setStatus(''); }}>提醒事项</button>
    </div>
    <p className="deadline-calendar-note">{systemTarget === 'calendar'
      ? draft.kind === 'deadline' ? '截止事项会作为标题带“截止”的日历事件写入。' : '事件会按当前开始、结束时间写入所选日历。'
      : draft.kind === 'deadline' ? '截止日期或时间会作为提醒事项的到期时间。' : '事件的开始时间会作为提醒事项的到期时间。'}</p>
    </>}
    <div className="schedule-actions">
      <button className="primary" disabled={!!busy} onClick={() => void saveLocal()}>{busy === 'local' ? '保存中…' : '保存到截然'}</button>
      {macIntegrationsAvailable && (systemTarget === 'calendar' ? (!calendars.length ? <button className="secondary" disabled={!!busy} onClick={() => void loadCalendars()}>{busy === 'calendars' ? '正在读取…' : '选择 Mac 日历…'}</button> : <>
        <select aria-label="目标 Mac 日历" value={calendarId} onChange={(e) => setCalendarId(e.target.value)}>{calendars.map((calendar) => <option value={calendar.id} key={calendar.id}>{calendar.name}</option>)}</select>
        <button className="secondary" disabled={!!busy || !calendarId} onClick={() => void saveMac()}>{busy === 'mac' ? '添加中…' : `确认添加${draft.kind === 'deadline' ? '截止事件' : ''}到 Mac 日历`}</button>
      </>) : (!reminderLists.length ? <button className="secondary" disabled={!!busy} onClick={() => void loadReminderLists()}>{busy === 'reminders' ? '正在读取…' : '选择提醒事项列表…'}</button> : <>
        <select aria-label="目标提醒事项列表" value={reminderListId} onChange={(e) => setReminderListId(e.target.value)}>{reminderLists.map((list) => <option value={list.id} key={list.id}>{list.name}</option>)}</select>
        <button className="secondary" disabled={!!busy || !reminderListId} onClick={() => void saveReminder()}>{busy === 'mac' ? '添加中…' : '确认添加到提醒事项'}</button>
      </>))}
      <span role="status">{status}</span>
    </div>
    {!macIntegrationsAvailable && <p className="deadline-calendar-note">Windows 体验版可保存到截然日程；系统日历和提醒事项写入尚未开放。</p>}
  </section>;
}

function modelName(profile: ModelProfile) { return `${providerFor(profile.provider).name} · ${profile.model}`; }

export function SchedulePanel({ items, shortcut, loading = false, onRefresh, onError }: {
  items: ScheduleJobSummary[]; shortcut: string; loading?: boolean; onRefresh(): Promise<void>; onError(error: string): void;
}) {
  const today = Temporal.Now.plainDateISO().toString();
  const [selectedDate, setSelectedDate] = useState(today);
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const [sourceJob, setSourceJob] = useState<ScheduleJob | null>(null);
  const [openEventId, setOpenEventId] = useState<string | null>(null);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [opening, setOpening] = useState(''); const [recordError, setRecordError] = useState('');
  const initialized = useRef(false); const request = useRef(0);
  const days = useRef(new Map<string, HTMLButtonElement>());
  const entries = useMemo<CalendarEntry[]>(() => items.flatMap(job => job.events.map(event => ({ jobId: job.id, event }))), [items]);
  const weeks = useMemo(() => monthWeeks(month), [month]);
  const selectedEntries = useMemo(() => entriesForDate(entries, selectedDate), [entries, selectedDate]);
  const selectedCaptures = capturesForDate(items, selectedDate);
  const markers = useMemo(() => new Map(weeks.flat().map(date => [date, { events: entriesForDate(entries, date), captures: capturesForDate(items, date) }])), [weeks, entries, items]);
  useEffect(() => {
    if (initialized.current || !entries.length) return;
    const first = entries.map(entry => eventDateRange(entry.event)?.start).find(Boolean);
    if (first) { setSelectedDate(first); setMonth(first.slice(0, 7)); initialized.current = true; }
  }, [entries]);
  useEffect(() => () => { request.current++; }, []);
  async function openJob(id: string, eventId: string | null = null) {
    const sequence = ++request.current; setOpening(id); setRecordError('');
    try {
      const result = await window.snipvia.schedule.open(id);
      if (sequence !== request.current) return;
      if (result.ok) { setSourceJob(result.value); setOpenEventId(eventId); if (eventId) setRecordsOpen(false); }
      else { setRecordError(result.error); onError(result.error); }
    } catch { if (sequence === request.current) { setRecordError('无法打开日程记录，请重试。'); onError('无法打开日程记录，请重试。'); } }
    finally { if (sequence === request.current) setOpening(''); }
  }
  function chooseDate(date: string, focus = false) {
    initialized.current = true; setSelectedDate(date); setMonth(date.slice(0, 7));
    if (focus) requestAnimationFrame(() => days.current.get(date)?.focus());
  }
  function closeRecords() { request.current++; setOpening(''); setRecordsOpen(false); }
  const editingEvent = sourceJob?.events.find(event => event.id === openEventId);
  const monthTitle = Temporal.PlainDate.from(`${month}-01`);
  const selectedDay = Temporal.PlainDate.from(selectedDate);
  const weekday = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][selectedDay.dayOfWeek - 1];
  const sections = [
    { title: '全天', values: selectedEntries.filter(entry => entry.event.kind === 'event' && entry.event.allDay) },
    { title: '时间安排', values: selectedEntries.filter(entry => entry.event.kind === 'event' && !entry.event.allDay) },
    { title: '截止事项', values: selectedEntries.filter(entry => entry.event.kind === 'deadline') }
  ];
  return <div className="schedule-panel workspace-panel" aria-busy={loading}>
    <WorkspaceHeader title="截图日程"><span className="workspace-shortcut-label">截图快捷键 <kbd>{shortcut}</kbd></span><Button className="workspace-action records-button" onClick={() => setRecordsOpen(true)}><Icon name="history" size={15} />识别记录{items.length > 0 && <span>{items.length}</span>}</Button></WorkspaceHeader>
    <div className="schedule-content">
      <section className="schedule-calendar" aria-label="月历">
        <div className="schedule-calendar-toolbar"><h2>{monthTitle.year} 年 {monthTitle.month} 月</h2><div>
          <IconButton icon="chevron" label="上个月" className="schedule-month-prev" onClick={() => chooseDate(moveMonth(selectedDate, -1))} />
          <Button variant="quiet" onClick={() => chooseDate(today)}>今天</Button>
          <IconButton icon="chevron" label="下个月" onClick={() => chooseDate(moveMonth(selectedDate, 1))} />
        </div></div>
        <div className="schedule-month-grid" role="grid" aria-label={`${monthTitle.year} 年 ${monthTitle.month} 月`}>
          <div className="schedule-weekdays" role="row">{['一', '二', '三', '四', '五', '六', '日'].map(day => <span role="columnheader" key={day}>{day}</span>)}</div>
          {weeks.map(dates => <div className="schedule-calendar-week" role="row" key={dates[0]}>{dates.map(date => {
            const marker = markers.get(date)!;
            return <button type="button" role="gridcell" key={date} data-date={date} ref={node => { if (node) days.current.set(date, node); else days.current.delete(date); }}
              className={`schedule-day${date.slice(0, 7) !== month ? ' outside' : ''}${date === today ? ' today' : ''}${date === selectedDate ? ' selected' : ''}${marker.events.length ? ' has-events' : ''}${marker.captures.length ? ' has-captures' : ''}`}
              aria-selected={date === selectedDate} aria-current={date === today ? 'date' : undefined} aria-label={`${date}，${marker.events.length} 项日程，${marker.captures.length} 张来源截图`}
              tabIndex={date === selectedDate ? 0 : -1} onClick={() => chooseDate(date)} onKeyDown={event => {
                const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
                if (offset !== undefined) { event.preventDefault(); chooseDate(Temporal.PlainDate.from(date).add({ days: offset }).toString(), true); }
                else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); const index = event.key === 'Home' ? 0 : 6; chooseDate(dates[index], true); }
                else if (event.key === 'PageUp' || event.key === 'PageDown') { event.preventDefault(); chooseDate(moveMonth(date, event.key === 'PageUp' ? -1 : 1), true); }
              }}>
              <span className="schedule-date-number">{Number(date.slice(8, 10))}</span><span className="schedule-day-markers" aria-hidden="true">
                {marker.events.length > 0 && <span className="schedule-event-mark" />}{marker.events.some(entry => entry.event.kind === 'deadline') && <span className="schedule-deadline-mark">◆</span>}{marker.captures.length > 0 && <span className="schedule-capture-mark" />}
              </span>{marker.events.length > 1 && <small>{marker.events.length} 项</small>}
            </button>;
          })}</div>)}
        </div>
        <div className="schedule-calendar-legend"><span><i className="schedule-event-mark" />日程</span><span><i className="schedule-capture-mark" />来源截图</span><span>◆ 截止事项</span><span className="schedule-today-legend">实心日期为今天</span></div>
      </section>
      <section className="schedule-date-detail" aria-label="日期详情">
        <div className="schedule-date-heading"><span>{selectedDay.year} 年 {selectedDay.month} 月 · {weekday}</span><h2>{selectedDay.day} 日{selectedDate === today && <small>今天</small>}</h2><p>{selectedEntries.length} 项日程 · {selectedCaptures.length} 张来源截图</p></div>
        <div className="schedule-date-scroll">
          {loading && !items.length ? <LoadingState>正在读取日程…</LoadingState> : !selectedEntries.length && !selectedCaptures.length ? <EmptyState icon="calendar" title="这一天还没有记录" description="选择带标记的日期，查看日程与来源截图。" /> : <>
            {sections.filter(section => section.values.length).map(section => <section className="schedule-agenda-section" key={section.title}><h3>{section.title}</h3>{section.values.map(entry => <button className="schedule-detail-event" key={entry.event.id} disabled={opening === entry.jobId} onClick={() => void openJob(entry.jobId, entry.event.id)}>
              <span className="schedule-detail-time">{eventTimeLabel(entry)}{!entry.event.allDay && entry.event.kind === 'event' && entry.event.endAt && <small>{Temporal.Instant.from(entry.event.endAt).toZonedDateTimeISO(entry.event.timezone).toPlainTime().toString().slice(0, 5)}</small>}</span>
              <span className="schedule-detail-copy"><strong>{entry.event.title}</strong><span>{[entry.event.location, entry.event.savedLocal ? '已存截然' : '未保存'].filter(Boolean).join(' · ')}</span>{eventSpanLabel(entry) && <small>{eventSpanLabel(entry)}</small>}<small>{entry.event.timezone}</small></span><Icon name="chevron" size={14} />
            </button>)}</section>)}
            {selectedCaptures.length > 0 && <section className="schedule-agenda-section"><h3>来源截图</h3>{selectedCaptures.map(item => <button className="schedule-detail-capture" key={item.id} onClick={() => { setRecordsOpen(true); void openJob(item.id); }} disabled={opening === item.id}>
              <Icon name="image" size={16} /><span><strong>{item.title}</strong><small>{item.status === 'failed' ? '识别失败' : item.status === 'extracting' ? '正在识别' : `${item.eventCount} 项识别结果`}</small></span><Icon name="chevron" size={14} />
            </button>)}</section>}
          </>}
          {opening && !recordsOpen && <LoadingState>正在打开记录…</LoadingState>}{recordError && !recordsOpen && !editingEvent && <p role="alert">{recordError}</p>}
        </div>
        <p className="schedule-local-note"><Icon name="info" size={13} />本地保存与添加到 Mac 日历是独立操作。</p>
      </section>
    </div>
    {recordsOpen && <Dialog label="识别记录" className="records-modal" onClose={closeRecords}>
      <div className="modal-header"><div><strong>识别记录</strong><small>{items.length} 条记录</small></div><IconButton icon="close" label="关闭识别记录" onClick={closeRecords} /></div>
      {items.length === 0 ? <EmptyState icon="history" title="暂无识别记录" description="截图中出现明确的日期、时间或待办信息时，会在这里保存识别结果。" /> : <div className="records-modal-body">
        <div className="records-list">{items.map(item => <button key={item.id} className={sourceJob?.id === item.id ? 'active' : ''} onClick={() => void openJob(item.id)} disabled={opening === item.id}><span className={`schedule-state ${item.status}`} /><span><strong>{item.title}</strong><small>{new Date(item.createdAt).toLocaleString()} · {item.status === 'extracting' ? '识别中' : item.status === 'failed' ? '识别失败' : `${item.eventCount} 项`}</small></span><Icon name="chevron" size={14} /></button>)}</div>
        <div className="record-preview">{opening ? <LoadingState>正在读取来源截图…</LoadingState> : recordError ? <p role="alert">{recordError}</p> : sourceJob ? <><img src={sourceJob.capture.dataUrl} alt="日程来源截图" /><div><strong>{sourceJob.title}</strong><small>{modelName(sourceJob.profile)}</small>{sourceJob.status === 'extracting' && <p>正在后台识别，完成后会收到系统通知。</p>}{sourceJob.error && <p className="schedule-source-error">{sourceJob.error}</p>}{sourceJob.events.map(event => <Button key={event.id} variant="quiet" onClick={() => { setRecordsOpen(false); setOpenEventId(event.id); }}>{event.title}<Icon name="chevron" size={14} /></Button>)}</div></> : <EmptyState icon="image" title="选择一条记录" description="查看来源截图与识别结果。" />}</div>
      </div>}
    </Dialog>}
    {editingEvent && sourceJob && <Dialog label={`编辑日程：${editingEvent.title}`} className="schedule-popover" onClose={() => setOpenEventId(null)}><div className="schedule-popover-header"><div><strong>{editingEvent.title}</strong><small>由 {modelName(sourceJob.profile)} 识别</small></div><IconButton icon="close" label="关闭日程编辑" onClick={() => setOpenEventId(null)} /></div><EventEditor jobId={sourceJob.id} event={editingEvent} onError={message => { setRecordError(message); onError(message); }} onUpdated={job => { setSourceJob(job); setRecordError(''); void onRefresh(); }} />{recordError && <p className="schedule-dialog-error" role="alert">{recordError}</p>}<div className="schedule-popover-source"><img src={sourceJob.capture.dataUrl} alt="日程来源截图" /><span>来源截图</span></div></Dialog>}
  </div>;
}
