import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AccrueMark, AccrueWordmark } from './AccrueMark.js';

function countPolygons(markup: string): number {
  return (markup.match(/<polygon/g) ?? []).length;
}

function fillsUsedIn(markup: string): string[] {
  return [...markup.matchAll(/fill="([^"]+)"/g)].map((match) => match[1] ?? '');
}

describe('AccrueMark', () => {
  it('draws the three rising levels in three jade tones', () => {
    const markup = renderToStaticMarkup(<AccrueMark />);
    expect(countPolygons(markup)).toBe(3);
    expect(fillsUsedIn(markup)).toStrictEqual([
      'var(--color-accent)',
      'var(--color-accent-deep)',
      'var(--color-accent-deeper)',
    ]);
  });

  it('draws the same three levels in one colour when monochrome', () => {
    const markup = renderToStaticMarkup(<AccrueMark monochrome />);
    expect(countPolygons(markup)).toBe(3);
    expect(new Set(fillsUsedIn(markup))).toStrictEqual(new Set(['var(--color-text)']));
  });

  it('takes a colour for one colour contexts such as a light background', () => {
    const markup = renderToStaticMarkup(
      <AccrueMark monochrome monochromeColor="#12110f" />,
    );
    expect(new Set(fillsUsedIn(markup))).toStrictEqual(new Set(['#12110f']));
  });

  it('hardcodes no hex value of its own', () => {
    const markup = renderToStaticMarkup(<AccrueMark />);
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
    expect(countPolygons(markup)).toBe(3);
  });
});
