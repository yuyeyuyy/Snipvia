import { useEffect, useRef, useState } from 'react';
import type { ConversationSummary, ModelProfile, PublicSettings } from '../../../shared/contracts';
import { credentialScope } from '../../../shared/providers';
import { chatModelId, chatModelChoices } from './model-choice';

/** Remember draft choices; committed choices already live in the existing history profile. */
export function useConversationModel({ id, saved, hasMessages, settings, history, activeId, onSwitch }: {
  history: ConversationSummary[];
  id: string | null; saved?: ModelProfile; hasMessages: boolean; settings: PublicSettings | null; activeId: string | null;
  onSwitch(profile: ModelProfile): Promise<void>;
}) {
  const [choices, setChoices] = useState<Record<string, ModelProfile>>({});
  const [seen, setSeen] = useState<ModelProfile[]>([]);
  useEffect(() => { if (settings) setSeen(values => {
    const next = new Map(values.map(profile => [chatModelId(profile), profile]));
    for (const profile of settings.configuredModels) next.set(chatModelId(profile), profile);
    return [...next.values()].slice(-100);
  }); }, [settings]);
  useEffect(() => { const retained = new Set(['new', ...history.map(item => item.id), ...(id ? [id] : [])]); setChoices(values => Object.fromEntries(Object.entries(values).filter(([key]) => retained.has(key)))); }, [history, id]);
  const [restoring, setRestoring] = useState(false), [failure, setFailure] = useState<{ stamp: string; message: string } | null>(null);
  const key = id ?? 'new'; const current = useRef(key); current.current = key;
  const callback = useRef(onSwitch); callback.current = onSwitch; const saving = useRef(false);
  const desired = id ? choices[key] ?? (hasMessages ? saved : undefined) : undefined;
  const scope = desired ? chatModelId(desired) : '';
  const available = !desired || !!settings?.configuredModels.some(profile => credentialScope(profile) === credentialScope(desired));
  const mismatch = !!desired && !!settings && scope !== chatModelId(settings);
  const stamp = `${key}:${scope}`;
  const failed = failure?.stamp === stamp ? failure.message : '';
  useEffect(() => {
    if (!mismatch || !available || !desired || !settings || activeId || saving.current || failed) return;
    saving.current = true; setRestoring(true);
    void callback.current(desired).catch(cause => { if (current.current === key) setFailure({ stamp, message: cause instanceof Error ? cause.message : '无法恢复原对话模型，请重新选择。' }); }).finally(() => { saving.current = false; setRestoring(false); });
  }, [key, scope, mismatch, available, activeId, settings, failed, restoring]);
  const issue = !available ? '原对话的厂商或接口已不在配置中，请选择可用模型后继续。' : failed || (mismatch && activeId ? '请等待正在生成的对话完成后恢复此会话模型。' : '');
  return { issue, options: chatModelChoices(settings, history, seen), restoring: restoring || mismatch && available && !activeId && !failed, blocked: mismatch || !available || !!failed, value: available && !failed ? settings ? chatModelId(settings) : '' : '', resetNew() { setChoices(values => { const next = { ...values }; delete next.new; return next; }); setFailure(null); }, async select(profile: ModelProfile) {
    if (saving.current || activeId) return;
    saving.current = true; const target = key;
    try { await callback.current(profile); setChoices(values => ({ ...values, [target]: profile })); setFailure(null); }
    catch (cause) { if (current.current === target) setFailure({ stamp, message: cause instanceof Error ? cause.message : '模型切换失败，请重试。' }); }
    finally { saving.current = false; }
  } };
}
