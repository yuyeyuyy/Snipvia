import type { Locator } from '@playwright/test';

/** Compare semantic colors in either OS appearance, using Chromium's own color serialization. */
export function tokenColor(locator: Locator, token: string) {
  return locator.evaluate((element, token) => {
    const probe = document.createElement('span'); probe.style.color = `var(--${token})`;
    // Inputs/selects cannot render child probes; use their parent for the same token scope.
    (element.parentElement ?? element).appendChild(probe); const color = getComputedStyle(probe).color; probe.remove(); return color;
  }, token);
}
