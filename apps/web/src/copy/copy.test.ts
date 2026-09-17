import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { RISK_ACKNOWLEDGEMENT_SENTENCES, RISK_ACKNOWLEDGEMENT_TITLE } from '@accrue/core';

import { ACKNOWLEDGEMENT_COPY } from './acknowledgement.js';
import { FORBIDDEN_WORD_EXCEPTIONS } from './forbiddenWordExceptions.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Every word and phrase that never appears anywhere a user reads, in any case. */
const FORBIDDEN: readonly string[] = [
  'safe',
  'guaranteed',
  'risk free',
  'no risk',
  'savings',
  'savings account',
  'passive income',
  'earn interest',
  'set and forget',
  'stable yield',
  'open source',
  'verified',
  'disappear',
  'disappears',
  'offline',
  'gone',
  'if Accrue',
];

/** The rescue page carries its own words, and they are held to the same list. */
const RESCUE_COPY_FILE = resolve(here, '../../../rescue/src/copy.ts');

function copyFiles(): string[] {
  return [
    ...readdirSync(here)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .map((name) => resolve(here, name)),
    RESCUE_COPY_FILE,
  ];
}

/** Every string literal and template chunk in the file, which is everything a user can read. */
function stringsIn(source: string): string[] {
  const found: string[] = [];
  const quoted = source.match(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/gu) ?? [];
  for (const literal of quoted) {
    found.push(literal.slice(1, -1));
  }
  const templates = source.match(/`(?:[^`\\]|\\.)*`/gsu) ?? [];
  for (const literal of templates) {
    // A value is elided to {} so an approved sentence can be written without it.
    found.push(literal.slice(1, -1).replace(/\$\{[^}]*\}/gu, '{}'));
  }
  return found;
}

function isAllowed(sentence: string): boolean {
  return FORBIDDEN_WORD_EXCEPTIONS.includes(sentence.trim());
}

describe('the words a user reads', () => {
  it('never uses a forbidden word outside an approved sentence', () => {
    const offences: string[] = [];
    for (const file of copyFiles()) {
      const source = readFileSync(file, 'utf8');
      for (const sentence of stringsIn(source)) {
        for (const word of FORBIDDEN) {
          const pattern = new RegExp(`\\b${word.replace(/ /gu, '\\s+')}\\b`, 'iu');
          if (pattern.test(sentence) && !isAllowed(sentence)) {
            offences.push(`${file.slice(here.length + 1)}: "${word}" in "${sentence}"`);
          }
        }
      }
    }
    expect(offences).toEqual([]);
  });

  it('keeps every exception matching the copy exactly', () => {
    const everything = copyFiles()
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    for (const allowed of FORBIDDEN_WORD_EXCEPTIONS) {
      // The sentence is stored escaped in the source, so compare on the unescaped strings.
      const appears = stringsIn(everything).some((sentence) => sentence === allowed);
      expect(appears, `the approved sentence is no longer in the copy: ${allowed}`).toBe(
        true,
      );
    }
  });

  it('shows the acknowledgement from the module and does not restate it', () => {
    expect(ACKNOWLEDGEMENT_COPY.title).toBe(RISK_ACKNOWLEDGEMENT_TITLE);
    // The exception list is the one place an approved sentence is written out again.
    const everything = copyFiles()
      .filter((file) => !file.endsWith('forbiddenWordExceptions.ts'))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    for (const sentence of RISK_ACKNOWLEDGEMENT_SENTENCES) {
      expect(
        everything.includes(sentence),
        'the acknowledgement sentences live in packages/core, not in the copy files',
      ).toBe(false);
    }
  });
});
