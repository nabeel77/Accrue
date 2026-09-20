import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AccrueMark, AccrueWordmark } from './AccrueMark.js';

const THE_STEP_LINE = 'M6 38 H16 V29 H26 V20 H36 V11 H42';

function countOf(markup: string, tag: string): number {
  return (markup.match(new RegExp(`<${tag}`, 'g')) ?? []).length;
}

function strokesUsedIn(markup: string): string[] {
  return [...markup.matchAll(/stroke="([^"]+)"/g)].map((match) => match[1] ?? '');
}

describe('AccrueMark', () => {
  it('draws the step line in jade with the gold dot at its last riser', () => {
    const markup = renderToStaticMarkup(<AccrueMark size={48} />);
    expect(markup).toContain(THE_STEP_LINE);
    expect(countOf(markup, 'path')).toBe(1);
    expect(countOf(markup, 'circle')).toBe(1);
    expect(strokesUsedIn(markup)).toStrictEqual(['var(--color-accent)']);
    expect(markup).toContain('fill="var(--color-gold)"');
  });

  it('never fills the line, so the mark stays a line', () => {
    const markup = renderToStaticMarkup(<AccrueMark size={48} />);
    expect(markup).toContain('fill="none"');
  });

  it('drops the dot below the size the brand keeps it at', () => {
    const small = renderToStaticMarkup(<AccrueMark size={16} />);
    expect(small).toContain(THE_STEP_LINE);
    expect(countOf(small, 'circle')).toBe(0);

    const large = renderToStaticMarkup(<AccrueMark size={24} />);
    expect(countOf(large, 'circle')).toBe(1);
  });

  it('draws one colour and no dot when monochrome', () => {
    const markup = renderToStaticMarkup(<AccrueMark size={48} monochrome />);
    expect(countOf(markup, 'circle')).toBe(0);
    expect(strokesUsedIn(markup)).toStrictEqual(['var(--color-text)']);
  });

  it('takes a colour for one colour contexts such as a light background', () => {
    const markup = renderToStaticMarkup(
      <AccrueMark monochrome monochromeColor="#12110f" />,
    );
    expect(strokesUsedIn(markup)).toStrictEqual(['#12110f']);
  });

  it('hardcodes no hex value of its own', () => {
    const markup = renderToStaticMarkup(<AccrueMark size={48} />);
    expect(markup).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it('carries the size it was asked for and a label for screen readers', () => {
    const markup = renderToStaticMarkup(<AccrueMark size={96} />);
    expect(markup).toContain('width="96"');
    expect(markup).toContain('height="96"');
    expect(markup).toContain('aria-label="Accrue"');
  });
});

describe('AccrueWordmark', () => {
  it('sets the word in lowercase next to the mark', () => {
    const markup = renderToStaticMarkup(<AccrueWordmark />);
    expect(markup).toContain('>accrue<');
    expect(markup).toContain(THE_STEP_LINE);
  });
});
