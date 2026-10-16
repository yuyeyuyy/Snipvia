import { _electron as electron, expect, type ElectronApplication } from '@playwright/test';

/** Launch the real client with the caller's temporary storage and model mocks. */
export async function launchDesktop(options: Parameters<typeof electron.launch>[0]): Promise<ElectronApplication> {
  const instance = await electron.launch(options);
  try {
    const main = await instance.firstWindow();
    await expect(main.locator('.app-shell')).toBeVisible();
    await expect.poll(() => instance.windows().filter(window => ['#capture', '#pin'].some(hash => window.url().endsWith(hash))).length).toBe(2);
    await instance.windows().find(window => window.url().endsWith('#capture'))!.locator('.capture-overlay').waitFor({ state: 'attached' });
    await instance.windows().find(window => window.url().endsWith('#pin'))!.locator('.pinned-capture').waitFor({ state: 'attached' });
    return instance;
  } catch (error) { await instance.close(); throw error; }
}
