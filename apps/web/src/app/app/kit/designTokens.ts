export interface DesignToken {
  name: string;
  value: string;
}

export interface DesignTokenGroup {
  title: string;
  note?: string;
  tokens: DesignToken[];
}

export const DESIGN_TOKEN_GROUPS: DesignTokenGroup[] = [
  {
    title: 'Ground',
    tokens: [
      { name: '--color-ground', value: '#0c0b0a' },
      { name: '--color-panel', value: '#121110' },
      { name: '--color-raised', value: '#191715' },
      { name: '--color-raised-2', value: '#171512' },
      { name: '--color-hairline', value: '#22201d' },
    ],
  },
  {
    title: 'Text',
    note: 'Nothing lighter than the primary tone, and pure white does not exist here.',
    tokens: [
      { name: '--color-text', value: '#f0ede8' },
      { name: '--color-text-secondary', value: '#9a938a' },
      { name: '--color-text-muted', value: '#6e675f' },
    ],
  },
  {
    title: 'Accent',
    note: 'Jade is the brand and every guard element. It never appears on a health bar.',
    tokens: [
      { name: '--color-accent', value: '#37b98d' },
      { name: '--color-accent-hover', value: '#6fd8b0' },
      { name: '--color-accent-deep', value: '#2e8f6e' },
      { name: '--color-accent-deeper', value: '#26654f' },
    ],
  },
  {
    title: 'Money',
    note: 'Gold is for money and yield figures only.',
    tokens: [{ name: '--color-gold', value: '#e2b871' }],
  },
  {
    title: 'Health',
    note: 'Position health only, never buttons, links or branding.',
    tokens: [
      { name: '--color-health-healthy', value: '#6fd08c' },
      { name: '--color-health-caution', value: '#e8b03a' },
      { name: '--color-health-danger', value: '#e2685c' },
      { name: '--color-danger-surface', value: '#5e2a24' },
    ],
  },
  {
    title: 'Type and shape',
    tokens: [
      { name: '--font-text', value: "'Geist', system-ui, sans-serif" },
      { name: '--font-mono', value: "'Geist Mono', ui-monospace, monospace" },
      { name: '--radius', value: '8px' },
      { name: '--radius-pill', value: '999px' },
    ],
  },
];
