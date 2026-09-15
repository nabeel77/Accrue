import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createFromRoot } from 'codama';
import { rootNodeFromAnchor, type AnchorIdl } from '@codama/nodes-from-anchor';
import { renderVisitor } from '@codama/renderers-js';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const idlPath = resolve(repositoryRoot, 'target/idl/accrue.json');
const clientDirectory = resolve(repositoryRoot, 'packages/solana/src/program');

function readAnchorIdl(): AnchorIdl {
  try {
    return JSON.parse(readFileSync(idlPath, 'utf8')) as AnchorIdl;
  } catch {
    throw new Error(`No IDL at ${idlPath}. Run \`anchor build\` first.`);
  }
}

const codama = createFromRoot(rootNodeFromAnchor(readAnchorIdl()));

rmSync(clientDirectory, { recursive: true, force: true });
await codama.accept(
  renderVisitor(clientDirectory, { deleteFolderBeforeRendering: true }),
);

function addFileExtensionsToRelativeImports(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      addFileExtensionsToRelativeImports(entryPath);
      continue;
    }
    if (!entry.name.endsWith('.ts')) {
      continue;
    }
    const original = readFileSync(entryPath, 'utf8');
    const rewritten = original
      .replaceAll('process.env.NODE_ENV', "process.env['NODE_ENV']")
      .replace(
        /(from\s+")(\.[^"]*?)(")/gu,
        (whole, before: string, importPath: string, after: string) => {
          if (importPath.endsWith('.js')) {
            return whole;
          }
          const target = resolve(directory, importPath);
          const withExtension = existsSync(`${target}.ts`)
            ? `${importPath}.js`
            : `${importPath}/index.js`;
          return `${before}${withExtension}${after}`;
        },
      );
    if (rewritten !== original) {
      writeFileSync(entryPath, rewritten);
    }
  }
}

addFileExtensionsToRelativeImports(clientDirectory);

console.log(`Generated the kit client into ${clientDirectory}`);
