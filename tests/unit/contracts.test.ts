import { describe, expect, it } from 'vitest';
import { defaults, scheduleDraftSchema, selectionSchema, settingsSchema } from '../../src/shared/contracts';

describe('IPC input validation', () => {
  it('rejects a preset provider paired with an unrelated endpoint', () => {
    expect(settingsSchema.safeParse({ ...defaults, endpoint: 'https://other.example/v1' }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...defaults, endpoint: defaults.endpoint.replace('https:', 'http:') }).success).toBe(false);
  });
  it.each(['https://example.com/v1', 'http://example.com/v1', 'http://192.168.1.10:8080/v1', 'http://127.0.0.1:11434/v1', 'http://localhost:8080/v1', 'http://[::1]:8080/v1'])('accepts supported endpoint %s', (endpoint) => {
    expect(settingsSchema.safeParse({ ...defaults, provider: 'custom', endpoint }).success).toBe(true);
  });
  it.each(['file:///tmp/key', 'https://user:password@example.com', 'http://user:password@example.com', 'https://example.com/?token=secret', 'http://example.com/v1#fragment'])('rejects unsafe endpoint %s', (endpoint) => {
    expect(settingsSchema.safeParse({ ...defaults, provider: 'custom', endpoint }).success).toBe(false);
  });
  it('rejects invalid geometry', () => {
    expect(selectionSchema.safeParse({ x: -1, y: 0, width: 30, height: 40 }).success).toBe(false);
    expect(selectionSchema.safeParse({ x: 0, y: NaN, width: 30, height: 40 }).success).toBe(false);
  });
  it('migrates the legacy schedule shortcut to one screenshot shortcut', () => {
    const legacy = { ...defaults, predictionBranches: undefined, scheduleShortcut: 'CommandOrControl+Shift+E' };
    const parsed = settingsSchema.parse(legacy);
    expect(parsed.shortcut).toBe(defaults.shortcut);
    expect('scheduleShortcut' in parsed).toBe(false);
    expect(parsed.continueShortcut).toBe(defaults.continueShortcut);
    expect(parsed.predictionBranches).toEqual(defaults.predictionBranches);
  });
  it('validates custom prediction branches and rejects duplicate ids', () => {
    const custom = {
      id: 'custom:786412d8-f0ea-470c-9211-2092994a85cc', trigger: 'code' as const,
      label: '生成测试', runningLabel: '正在生成测试…', prompt: 'Generate focused tests.',
      enabled: true, builtin: false, mode: 'ai' as const
    };
    expect(settingsSchema.safeParse({ ...defaults, predictionBranches: [...defaults.predictionBranches, custom] }).success).toBe(true);
    expect(settingsSchema.safeParse({ ...defaults, predictionBranches: [custom, custom] }).success).toBe(false);
  });
  it('keeps the two global shortcuts distinct', () => {
    expect(settingsSchema.safeParse({ ...defaults, continueShortcut: defaults.shortcut }).success).toBe(false);
  });
  it('validates time-range events and date or time based deadlines independently', () => {
    const base = { title: '提交方案', timezone: 'Asia/Shanghai', location: '', people: [], notes: '', unresolvedFields: [], warnings: [],
      startAt: null, endAt: null, startDate: null, endDate: null, dueAt: null, dueDate: null };
    expect(scheduleDraftSchema.safeParse({ ...base, kind: 'deadline', allDay: true, dueDate: '2026-09-30' }).success).toBe(true);
    expect(scheduleDraftSchema.safeParse({ ...base, kind: 'deadline', allDay: false, dueAt: '2026-09-30T18:00:00+08:00' }).success).toBe(true);
    expect(scheduleDraftSchema.safeParse({ ...base, kind: 'deadline', allDay: true }).success).toBe(false);
    expect(scheduleDraftSchema.safeParse({ ...base, kind: 'event', allDay: false, dueAt: '2026-09-30T18:00:00+08:00' }).success).toBe(false);
  });
});
