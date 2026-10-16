import { expect, type Page } from '@playwright/test';

/** Check rendered app chrome (including injected editor CSS), never user image pixels. */
export async function expectNeutralChrome(page: Page) {
  const failures = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    const problems: string[] = [];
    for (const element of document.body.querySelectorAll('*')) {
      if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) || element.matches('img, canvas, video')) continue;
      for (const pseudo of [null, '::before', '::after']) {
        const style = getComputedStyle(element, pseudo);
        if (pseudo && ['none', 'normal'].includes(style.content)) continue;
        const label = `${element.tagName}.${element.getAttribute('class') ?? ''}${pseudo ?? ''}`;
        for (const property of ['color', 'backgroundColor', 'borderTopColor', 'borderBottomColor', 'borderLeftColor', 'borderRightColor', 'outlineColor', 'fill', 'stroke'] as const) {
          if (!CSS.supports('color', style[property])) continue;
          context.clearRect(0, 0, 1, 1); context.fillStyle = style[property]; context.fillRect(0, 0, 1, 1);
          const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
          if (alpha && (red !== green || green !== blue)) problems.push(`${label} ${property} ${style[property]}`);
        }
        if (style.filter.includes('grayscale')) problems.push(`${label} desaturation filter`);
        if (style.backgroundImage.includes('gradient(')) problems.push(`${label} gradient: ${style.backgroundImage}`);
      }
    }
    return problems.slice(0, 30);
  });
  expect(failures).toEqual([]);
}
