export interface HeroPalette {
  readonly accent: string;
  readonly accentDeep: string;
  readonly accentDeeper: string;
  readonly gold: string;
  readonly hairline: string;
  readonly muted: string;
}

function tokenValue(element: Element, name: string): string {
  return getComputedStyle(element).getPropertyValue(name).trim();
}

export function readLandingPalette(element: Element): HeroPalette {
  return {
    accent: tokenValue(element, '--color-accent'),
    accentDeep: tokenValue(element, '--color-accent-deep'),
    accentDeeper: tokenValue(element, '--color-accent-deeper'),
    gold: tokenValue(element, '--color-gold'),
    hairline: tokenValue(element, '--color-hairline'),
    muted: tokenValue(element, '--color-text-muted'),
  };
}

// A canvas gradient needs a concrete colour, so the token's hex is reused with an alpha.
export function withAlpha(colour: string, alpha: number): string {
  const hex = colour.replace('#', '');
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((digit) => `${digit}${digit}`)
          .join('')
      : hex;
  const red = Number.parseInt(full.slice(0, 2), 16);
  const green = Number.parseInt(full.slice(2, 4), 16);
  const blue = Number.parseInt(full.slice(4, 6), 16);
  if (Number.isNaN(red) || Number.isNaN(green) || Number.isNaN(blue)) {
    return colour;
  }
  return `rgba(${red},${green},${blue},${alpha})`;
}
