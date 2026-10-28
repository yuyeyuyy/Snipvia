export const legacySettingsFixture = {
  provider: 'openai', endpoint: 'https://api.openai.com/v1', model: 'legacy-model',
  shortcut: 'CommandOrControl+Shift+Space', editorShortcut: 'CommandOrControl+Shift+A',
  continueShortcut: 'CommandOrControl+Shift+Enter',
  predictionBranches: [{ id: 'explain-code', trigger: 'code', enabled: true, prompt: 'Synthetic legacy prompt' }]
};
