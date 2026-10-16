import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { scheduleDraftSchema, type Capture, type ModelProfile, type ScheduleDraft, type ScheduleJob, type ScheduleJobSummary } from '../../shared/contracts';
import { providerIds } from '../../shared/providers';

const storedEventSchema = scheduleDraftSchema.safeExtend({
  id: z.string().uuid(), savedLocal: z.boolean(),
  macCalendar: z.object({ id: z.string(), name: z.string(), savedAt: z.string() }).optional(),
  macReminder: z.object({ id: z.string(), name: z.string(), savedAt: z.string() }).optional()
});
const storedJobSchema = z.object({
  id: z.string().uuid(), status: z.enum(['extracting', 'draft', 'failed']), createdAt: z.string(), updatedAt: z.string(),
  error: z.string().optional(), events: z.array(storedEventSchema),
  profile: z.object({ provider: z.enum(providerIds), endpoint: z.string(), model: z.string() }),
  capture: z.object({ id: z.string().uuid(), fileName: z.string().regex(/^[0-9a-f-]+\.jpg$/), width: z.number().int().positive(), height: z.number().int().positive(), createdAt: z.string() })
});
type StoredJob = z.infer<typeof storedJobSchema>;

let jobs: StoredJob[] = [];
let available = false;
const root = () => join(app.getPath('userData'), 'schedule');
const captures = () => join(root(), 'captures');
const indexFile = () => join(root(), 'jobs.json');

function ensureDirectories() { mkdirSync(captures(), { recursive: true, mode: 0o700 }); }
function assertAvailable() { if (!available) throw new Error('日程记录未就绪，请重启应用或检查日程索引文件'); }
function persist() {
  ensureDirectories();
  writeFileSync(`${indexFile()}.tmp`, JSON.stringify(jobs, null, 2), { mode: 0o600 });
  renameSync(`${indexFile()}.tmp`, indexFile());
}
function findJob(id: string) {
  const job = jobs.find((item) => item.id === id);
  if (!job) throw new Error('日程识别记录不存在或已被删除');
  return job;
}
function summaryOf(job: StoredJob): ScheduleJobSummary {
  return { id: job.id, status: job.status, createdAt: job.createdAt, updatedAt: job.updatedAt,
    title: job.events[0]?.title ?? (job.status === 'extracting' ? '正在识别截图…' : '识别失败'),
    eventCount: job.events.length, profile: { ...job.profile },
    events: job.events.map((event) => ({ ...event, people: [...event.people], warnings: [...event.warnings], unresolvedFields: [...event.unresolvedFields] })),
    ...(job.error ? { error: job.error } : {}) };
}

export function loadSchedule() {
  available = false; ensureDirectories();
  if (!existsSync(indexFile())) { jobs = []; available = true; return; }
  jobs = z.array(storedJobSchema).parse(JSON.parse(readFileSync(indexFile(), 'utf8')));
  available = true;
}

export function createScheduleJob(capture: Omit<Capture, 'conversationId' | 'dataUrl'>, jpeg: Buffer, profile: ModelProfile) {
  assertAvailable();
  const id = randomUUID(); const fileName = `${capture.id}.jpg`;
  writeFileSync(join(captures(), `${fileName}.tmp`), jpeg, { mode: 0o600 });
  renameSync(join(captures(), `${fileName}.tmp`), join(captures(), fileName));
  const job: StoredJob = { id, status: 'extracting', createdAt: capture.createdAt, updatedAt: capture.createdAt,
    profile: { ...profile }, capture: { ...capture, fileName }, events: [] };
  jobs.unshift(job);
  try { persist(); } catch (error) { jobs.shift(); unlinkSync(join(captures(), fileName)); throw error; }
  return id;
}

export function completeScheduleJob(id: string, drafts: ScheduleDraft[]) {
  assertAvailable(); const job = findJob(id); const previous = { ...job, events: job.events.slice() };
  job.status = 'draft'; job.updatedAt = new Date().toISOString(); delete job.error;
  job.events = drafts.map((draft) => ({ ...scheduleDraftSchema.parse(draft), id: randomUUID(), savedLocal: false }));
  try { persist(); } catch (error) { Object.assign(job, previous); throw error; }
}

export function failScheduleJob(id: string, error: string) {
  assertAvailable(); const job = findJob(id); const previous = { ...job };
  job.status = 'failed'; job.updatedAt = new Date().toISOString(); job.error = error.slice(0, 1000);
  try { persist(); } catch (failure) { Object.assign(job, previous); throw failure; }
}

export function listScheduleJobs() { assertAvailable(); return jobs.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(summaryOf); }

export function readScheduleJob(id: string): ScheduleJob {
  assertAvailable(); const job = findJob(id); const file = join(captures(), basename(job.capture.fileName));
  if (!existsSync(file)) throw new Error('日程截图文件不存在');
  return { ...summaryOf(job), capture: { id: job.capture.id, dataUrl: `data:image/jpeg;base64,${readFileSync(file).toString('base64')}`,
    width: job.capture.width, height: job.capture.height, createdAt: job.capture.createdAt } };
}

export function saveScheduleEvent(jobId: string, eventId: string, draft: ScheduleDraft, savedLocal = true) {
  assertAvailable(); const job = findJob(jobId); const event = job.events.find((item) => item.id === eventId);
  if (!event) throw new Error('候选日程不存在或已被删除');
  const previous = { ...event }; Object.assign(event, scheduleDraftSchema.parse(draft), { savedLocal }); job.updatedAt = new Date().toISOString();
  try { persist(); } catch (error) { Object.assign(event, previous); throw error; }
  return readScheduleJob(jobId);
}

export function markMacSaved(jobId: string, eventId: string, draft: ScheduleDraft, calendar: { id: string; name: string }) {
  assertAvailable(); const job = findJob(jobId); const event = job.events.find((item) => item.id === eventId);
  if (!event) throw new Error('候选日程不存在或已被删除');
  const previous = { ...event }; Object.assign(event, scheduleDraftSchema.parse(draft));
  event.macCalendar = { ...calendar, savedAt: new Date().toISOString() }; job.updatedAt = new Date().toISOString();
  try { persist(); } catch (error) { Object.assign(event, previous); throw error; }
  return readScheduleJob(jobId);
}

export function markMacReminderSaved(jobId: string, eventId: string, draft: ScheduleDraft, list: { id: string; name: string }) {
  assertAvailable(); const job = findJob(jobId); const event = job.events.find((item) => item.id === eventId);
  if (!event) throw new Error('候选日程不存在或已被删除');
  const previous = { ...event }; Object.assign(event, scheduleDraftSchema.parse(draft));
  event.macReminder = { ...list, savedAt: new Date().toISOString() }; job.updatedAt = new Date().toISOString();
  try { persist(); } catch (error) { Object.assign(event, previous); throw error; }
  return readScheduleJob(jobId);
}

export function deleteScheduleJob(id: string) {
  assertAvailable(); const index = jobs.findIndex((job) => job.id === id); if (index < 0) throw new Error('日程记录不存在或已被删除');
  const [job] = jobs.splice(index, 1); try { persist(); } catch (error) { jobs.splice(index, 0, job); throw error; }
  const file = join(captures(), basename(job.capture.fileName)); if (existsSync(file)) unlinkSync(file); return true;
}
