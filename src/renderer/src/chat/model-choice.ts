import type { ModelProfile, PublicSettings, ConversationSummary } from '../../../shared/contracts';
import { credentialScope } from '../../../shared/providers';

/** Credential scopes identify a key; UI choices must additionally identify the model. */
export function chatModelId(profile: ModelProfile) { return JSON.stringify([credentialScope(profile), profile.model]); }

export function chatModelChoices(settings: PublicSettings | null, history: ConversationSummary[], seen: ModelProfile[]): ModelProfile[] {
  if (!settings) return [];
  const scopes = new Set(settings.configuredModels.map(credentialScope));
  const choices = new Map<string, ModelProfile>();
  for (const profile of [...settings.configuredModels, ...seen, ...history.map(item => item.profile)]) if (scopes.has(credentialScope(profile))) choices.set(chatModelId(profile), profile);
  return [...choices.values()];
}
