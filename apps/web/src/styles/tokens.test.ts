import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DESIGN_TOKEN_GROUPS } from '../app/app/kit/designTokens.js';

const tokenSheetPath = resolve(dirname(fileURLToPath(import.meta.url)), './tokens.css');
const tokenSheet = readFileSync(tokenSheetPath, 'utf8');

const EXPECTED_TOKENS: Record<string, string> = {
  '--color-ground': '#0c0b0a',
  '--color-panel': '#121110',
  '--color-raised': '#191715',
  '--color-raised-2': '#171512',
  '--color-hairline': '#22201d',
  '--color-text': '#f0ede8',
  '--color-text-secondary': '#9a938a',
  '--color-text-muted': '#6e675f',
  '--color-accent': '#37b98d',
  '--color-accent-hover': '#6fd8b0',
  '--color-accent-deep': '#2e8f6e',
  '--color-accent-deeper': '#26654f',
  '--color-gold': '#e2b871',
  '--color-health-healthy': '#6fd08c',
  '--color-health-caution': '#e8b03a',
  '--color-health-danger': '#e2685c',
  '--color-danger-surface': '#5e2a24',
  '--font-text': "'Geist', system-ui, sans-serif",
  '--font-mono': "'Geist Mono', ui-monospace, monospace",
  '--radius': '8px',
  '--radius-pill': '999px',
};

function readDeclaredTokens(sheet: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const line of sheet.split('\n')) {
    const match = /^\s*(--[a-z0-9-]+):\s*(.+);\s*$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      declarations.set(match[1], match[2].trim());
    }
  }
  return declarations;
}

const declaredTokens = readDeclaredTokens(tokenSheet);

describe('the token sheet', () => {
  it('declares every token from the design brief with its exact value', () => {
    for (const [name, value] of Object.entries(EXPECTED_TOKENS)) {
      expect(declaredTokens.get(name), name).toBe(value);
    }
  });

  it('declares nothing beyond the brief', () => {
    expect([...declaredTokens.keys()].sort()).toStrictEqual(
      Object.keys(EXPECTED_TOKENS).sort(),
    );
  });

  it('contains no hex value outside the brief', () => {
    const hexValuesInSheet = tokenSheet.match(/#[0-9a-fA-F]{3,8}/g) ?? [];
    const allowedHexValues = new Set(
      Object.values(EXPECTED_TOKENS).filter((value) => value.startsWith('#')),
    );
    for (const hexValue of hexValuesInSheet) {
      expect(allowedHexValues.has(hexValue.toLowerCase()), hexValue).toBe(true);
    }
  });

  it('never uses pure black or pure white', () => {
    const sheetInLowerCase = tokenSheet.toLowerCase();
    expect(sheetInLowerCase).not.toContain('#000');
    expect(sheetInLowerCase).not.toContain('#fff');
  });
});

describe('the design kit page', () => {
  it('shows every token the sheet declares, with the same value', () => {
    const shownTokens = new Map(
      DESIGN_TOKEN_GROUPS.flatMap((group) =>
        group.tokens.map((token) => [token.name, token.value] as const),
      ),
    );
    expect([...shownTokens.keys()].sort()).toStrictEqual(
      [...declaredTokens.keys()].sort(),
    );
    for (const [name, value] of shownTokens) {
      expect(declaredTokens.get(name), name).toBe(value);
    }
  });
});
