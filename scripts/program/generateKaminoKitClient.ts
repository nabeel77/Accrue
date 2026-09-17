import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createFromRoot } from 'codama';
import { rootNodeFromAnchor, type AnchorIdl } from '@codama/nodes-from-anchor';
import { renderVisitor } from '@codama/renderers-js';

// The keeper only ever asks the lending market to recompute what it already knows. The devnet
// sandbox scripts also stand a market up from nothing, which is the rest of this list.
const KAMINO_INSTRUCTIONS_WE_BUILD_OFF_CHAIN = [
  'refreshReserve',
  'refreshObligation',
  'initLendingMarket',
  'updateLendingMarket',
  'initReserve',
  'updateReserveConfig',
  'depositReserveLiquidity',
  'initGlobalConfig',
  'markObligationForDeleveraging',
];

const TYPES_THOSE_INSTRUCTIONS_NEED = ['UpdateConfigMode', 'UpdateLendingMarketMode'];

const KAMINO_LEND_PROGRAM_ADDRESS = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const idlPath = resolve(repositoryRoot, 'programs/accrue/idl/klend.json');
const clientDirectory = resolve(repositoryRoot, 'packages/solana/src/kamino/generated');

interface LegacyAnchorIdl {
  name?: string;
  version?: string;
  instructions: { name: string }[];
  accounts?: unknown[];
  types?: { name: string }[];
  errors?: unknown[];
  metadata?: Record<string, unknown>;
}

function keepOnlyWhatWeBuildOffChain(idl: LegacyAnchorIdl): LegacyAnchorIdl {
  const kept = idl.instructions.filter((instruction) =>
    KAMINO_INSTRUCTIONS_WE_BUILD_OFF_CHAIN.includes(instruction.name),
  );
  const missing = KAMINO_INSTRUCTIONS_WE_BUILD_OFF_CHAIN.filter(
    (name) => !kept.some((instruction) => instruction.name === name),
  );
  if (missing.length > 0) {
    throw new Error(`The klend IDL no longer has: ${missing.join(', ')}`);
  }

  return {
    ...idl,
    name: 'kamino_lending',
    version: idl.version ?? '0.0.0',
    instructions: kept,
    accounts: [],
    types: (idl.types ?? []).filter((type) =>
      TYPES_THOSE_INSTRUCTIONS_NEED.includes(type.name),
    ),
    errors: [],
    metadata: { ...(idl.metadata ?? {}), address: KAMINO_LEND_PROGRAM_ADDRESS },
  };
}

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

const idl = keepOnlyWhatWeBuildOffChain(
  JSON.parse(readFileSync(idlPath, 'utf8')) as LegacyAnchorIdl,
);
const codama = createFromRoot(rootNodeFromAnchor(idl as unknown as AnchorIdl));

rmSync(clientDirectory, { recursive: true, force: true });
await codama.accept(
  renderVisitor(clientDirectory, { deleteFolderBeforeRendering: true }),
);
addFileExtensionsToRelativeImports(clientDirectory);

console.log(
  `Generated ${KAMINO_INSTRUCTIONS_WE_BUILD_OFF_CHAIN.length} lending market instruction builders into ${clientDirectory}`,
);
