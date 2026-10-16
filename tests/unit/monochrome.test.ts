import { describe, expect, it } from 'vitest';
import tokens from '../../src/shared/design-tokens.json';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function luminance(hex: string) {
  const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}
function contrast(foreground: string, background: string) {
  const [low, high] = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
  return (high + .05) / (low + .05);
}

describe.each(['light', 'dark'] as const)('Monochrome %s palette', mode => {
  const palette = tokens[mode];
  it('contains only neutral RGB channels, including translucent capture chrome and shadows', () => {
    for (const [name, value] of Object.entries(palette)) {
      for (const [hex] of value.matchAll(/#[\da-fA-F]{6}(?:[\da-fA-F]{2})?\b/g)) {
        const channels = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map(channel => parseInt(channel, 16));
        expect(new Set(channels).size, `${mode}.${name}: ${hex}`).toBe(1);
      }
    }
  });
  it('provides readable normal text, code, primary buttons, switch thumbs and keyboard focus', () => {
    for (const foreground of ['text-primary', 'text-secondary', 'text-muted'] as const) {
      for (const background of ['bg-window', 'bg-nav', 'bg-panel', 'bg-raised', 'bg-hover', 'bg-selected'] as const) {
        expect(contrast(palette[foreground], palette[background]), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    for (const foreground of ['code-text', 'code-comment', 'code-keyword', 'code-string', 'code-number', 'code-function', 'code-variable', 'code-type'] as const) {
      expect(contrast(palette[foreground], palette['code-bg']), foreground).toBeGreaterThanOrEqual(4.5);
    }
    for (const background of ['accent', 'accent-hover', 'accent-active'] as const) {
      expect(contrast(palette['text-on-accent'], palette[background]), background).toBeGreaterThanOrEqual(4.5);
    }
    for (const state of ['success', 'warning', 'danger'] as const) {
      expect(contrast(palette[state], palette[`${state}-bg`]), state).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(palette['control-thumb-active'], palette.accent)).toBeGreaterThanOrEqual(3);
    for (const background of ['bg-window', 'bg-nav', 'bg-panel', 'bg-raised', 'bg-selected'] as const) {
      expect(contrast(palette.focus, palette[background]), `focus on ${background}`).toBeGreaterThanOrEqual(3);
    }
  });
});

it('does not desaturate images or reintroduce colored styles in renderer CSS', () => {
  function visit(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith('.css')) {
        const css = readFileSync(path, 'utf8');
        expect(css, path).not.toMatch(/grayscale\(|(?:linear|radial)-gradient\(|\b(?:blue|sky|indigo|cyan|violet)\b/);
      }
    }
  }
  visit('src/renderer/src');
});
