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

const CLUSTER_ADDRESSES: Readonly<Record<string, string>> = {
  KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD: 'KAMINO_LENDING_PROGRAM_ADDRESS',
  FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr: 'KAMINO_FARMS_PROGRAM_ADDRESS',
  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: 'JUPITER_V6_PROGRAM_ADDRESS',
  HFn8GnPADiny6XqUoWE8uRPPxb29ikn4yTuPa9MF2fWJ: 'SCOPE_PROGRAM_ADDRESS',
};

function pointDefaultAddressesAtTheClusterModule(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      pointDefaultAddressesAtTheClusterModule(entryPath);
      continue;
    }
    if (!entry.name.endsWith('.ts')) {
      continue;
    }
    const original = readFileSync(entryPath, 'utf8');
    const named = new Set<string>();
    const rewritten = original.replace(
      /"([1-9A-HJ-NP-Za-km-z]{32,44})" as Address<"\1">/gu,
      (whole, address: string) => {
        const constant = CLUSTER_ADDRESSES[address];
        if (constant === undefined) {
          return whole;
        }
        named.add(constant);
        return `(${constant} as Address<"${address}">)`;
      },
    );
    if (named.size === 0) {
      continue;
    }
    const depth = entryPath.slice(clientDirectory.length + 1).split('/').length;
    const upwards = '../'.repeat(depth);
    const importLine = `import { ${[...named].sort().join(', ')} } from "${upwards}programIds.js";\n`;
    writeFileSync(entryPath, importLine + rewritten);
  }
}

addFileExtensionsToRelativeImports(clientDirectory);
pointDefaultAddressesAtTheClusterModule(clientDirectory);

console.log(`Generated the kit client into ${clientDirectory}`);
