import { describe, expect, it } from 'vitest';
import { calendarOperationError } from '../../src/main/calendar/mac-calendar';

describe('Mac Calendar errors', () => {
  it('distinguishes permission denial, unavailable calendars and timeouts', () => {
    expect(calendarOperationError({ stderr: 'execution error: Not authorized to send Apple events to Calendar. (-1743)' }).message).toContain('自动化');
    expect(calendarOperationError({ stderr: 'execution error: Not authorized to send Apple events to Reminders. (-1743)' }).message).toContain('提醒事项');
    expect(calendarOperationError({ stderr: 'Error: SNIPVIA_CALENDAR_NOT_WRITABLE' }).message).toContain('不可写');
    expect(calendarOperationError({ stderr: 'Error: SNIPVIA_REMINDER_LIST_NOT_FOUND' }).message).toContain('提醒事项');
    expect(calendarOperationError({ stderr: '', killed: true }).message).toContain('超时');
  });

  it('returns only a safe error category, not a private event payload', () => {
    const error = { stderr: 'Error: SyntaxError: unexpected token', message: 'osascript -- {"title":"私人会议"}' };
    expect(calendarOperationError(error).message).toContain('脚本运行失败');
    expect(calendarOperationError(error).message).not.toContain('私人会议');
    expect(calendarOperationError({ stderr: 'execution error: Calendar error (-1728)' }).message).toContain('错误码 -1728');
  });
});
