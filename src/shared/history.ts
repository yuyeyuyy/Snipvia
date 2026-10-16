import { z } from 'zod';

export const conversationRenameSchema = z.strictObject({
  id: z.string().uuid(),
  title: z.string().trim().min(1, '请输入对话名称').max(120, '对话名称最多 120 个字符')
    .refine(title => Array.from(title).every(char => { const point = char.codePointAt(0)!; return point >= 32 && point !== 127 && point !== 0x2028 && point !== 0x2029; }), '对话名称不能包含换行或控制字符')
});
