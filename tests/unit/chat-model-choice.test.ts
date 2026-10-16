import { describe, expect, it } from 'vitest';
import type { ConversationSummary, ModelProfile, PublicSettings } from '../../src/shared/contracts';
import { defaults } from '../../src/shared/contracts';
import { chatModelChoices, chatModelId } from '../../src/renderer/src/chat/model-choice';

const profile = (model: string, endpoint = 'https://example.test/v1'): ModelProfile => ({ provider: 'custom', endpoint, model });
const record = (profile: ModelProfile): ConversationSummary => ({ id: crypto.randomUUID(), title: '测试', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messageCount: 2, profile });

describe('chat model identity and configured credential reuse', () => {
  it('distinguishes different models sharing a credential and normalizes trailing slashes without changing key scope', () => {
    expect(chatModelId(profile('a'))).not.toBe(chatModelId(profile('b')));
    expect(chatModelId(profile('a'))).toBe(chatModelId(profile('a', 'https://example.test/v1/')));
    expect(chatModelId({ ...profile('a'), provider: 'openai' })).not.toBe(chatModelId(profile('a')));
  });
  it('keeps actual configured and historically used model IDs, deduplicates, and excludes removed endpoints', () => {
    const a = profile('a'), b = profile('b'), gone = profile('old', 'https://removed.test/v1');
    const settings: PublicSettings = { ...defaults, ...a, hasApiKey: true, configuredModels: [a], configuredServices: [], credentialStorage: 'macos-keychain' };
    expect(chatModelChoices(settings, [record(b), record(a), record(gone)], [a, profile('c'), gone]).map(item => item.model)).toEqual(['a', 'c', 'b']);
    expect(chatModelChoices(null, [record(b)], [a])).toEqual([]);
  });
});
