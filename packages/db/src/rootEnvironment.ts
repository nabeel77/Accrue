import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const HOW_FAR_UP_TO_LOOK = 6;

// Migrations run from a laptop, where the connection strings live in the repository root file.
// The tools that read this config bundle it, and a bundle has no directory of its own, so the
// file is looked for from wherever the command was run, upward.
function theRootEnvironmentFile(): string | null {
  let here = process.cwd();
  for (let step = 0; step < HOW_FAR_UP_TO_LOOK; step += 1) {
    const candidate = resolve(here, '.env');
    if (existsSync(candidate)) {
      return candidate;
    }
    here = resolve(here, '..');
  }
  return null;
}

export function loadTheRootEnvironment(): void {
  if (process.env['DATABASE_DIRECT_URL']) {
    return;
  }
  const file = theRootEnvironmentFile();
  if (file !== null) {
    process.loadEnvFile(file);
  }
}
