import { readFileSync, rmSync } from 'node:fs';
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

console.log(`Generated the kit client into ${clientDirectory}`);
