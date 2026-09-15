import {
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { createFromRoot } from 'codama';
import { rootNodeFromAnchor, type AnchorIdl } from '@codama/nodes-from-anchor';
import { renderVisitor as renderRustVisitor } from '@codama/renderers-rust';

// The lending market refuses a cross program call on the plain deposit, borrow, repay and
// withdraw instructions, so the position signs the V2 forms, which carry the farm accounts
// inline instead of expecting sibling refresh instructions in the same transaction.
const KAMINO_INSTRUCTIONS_WE_CALL = [
  'initUserMetadata',
  'initObligation',
  'initObligationFarmsForReserve',
  'refreshReserve',
  'refreshObligation',
  'depositReserveLiquidityAndObligationCollateralV2',
  'borrowObligationLiquidityV2',
  'repayObligationLiquidityV2',
  'withdrawObligationCollateralAndRedeemReserveCollateralV2',
];

const TYPES_THOSE_INSTRUCTIONS_NEED = ['InitObligationArgs'];

const KAMINO_LEND_PROGRAM_ADDRESS = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const idlPath = resolve(repositoryRoot, 'programs/accrue/idl/klend.json');
const generatedDirectory = resolve(
  repositoryRoot,
  'programs/accrue/src/kamino/generated',
);

interface LegacyAnchorIdl {
  name?: string;
  version?: string;
  instructions: { name: string }[];
  accounts?: unknown[];
  types?: { name: string }[];
  errors?: unknown[];
  metadata?: Record<string, unknown>;
}

function readKlendIdl(): LegacyAnchorIdl {
  return JSON.parse(readFileSync(idlPath, 'utf8')) as LegacyAnchorIdl;
}

function keepOnlyWhatWeCall(idl: LegacyAnchorIdl): LegacyAnchorIdl {
  const keptInstructions = idl.instructions.filter((instruction) =>
    KAMINO_INSTRUCTIONS_WE_CALL.includes(instruction.name),
  );

  const missing = KAMINO_INSTRUCTIONS_WE_CALL.filter(
    (name) => !keptInstructions.some((instruction) => instruction.name === name),
  );
  if (missing.length > 0) {
    throw new Error(`The klend IDL no longer has: ${missing.join(', ')}`);
  }

  return {
    ...idl,
    name: 'kamino_lending',
    version: idl.version ?? '0.0.0',
    instructions: keptInstructions,
    accounts: [],
    types: (idl.types ?? []).filter((type) =>
      TYPES_THOSE_INSTRUCTIONS_NEED.includes(type.name),
    ),
    errors: [],
    metadata: { ...(idl.metadata ?? {}), address: KAMINO_LEND_PROGRAM_ADDRESS },
  };
}

const filteredIdl = keepOnlyWhatWeCall(readKlendIdl());
const codama = createFromRoot(rootNodeFromAnchor(filteredIdl as unknown as AnchorIdl));

const RUST_KEYWORDS = new Set([
  'as',
  'break',
  'const',
  'continue',
  'crate',
  'dyn',
  'else',
  'enum',
  'extern',
  'false',
  'fn',
  'for',
  'if',
  'impl',
  'in',
  'let',
  'loop',
  'match',
  'mod',
  'move',
  'mut',
  'pub',
  'ref',
  'return',
  'self',
  'static',
  'struct',
  'super',
  'trait',
  'true',
  'type',
  'unsafe',
  'use',
  'where',
  'while',
  'async',
  'await',
  'try',
]);

function removeRawIdentifiersFromModuleDeclarations(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      removeRawIdentifiersFromModuleDeclarations(entryPath);
      continue;
    }
    if (!entry.name.endsWith('.rs')) {
      continue;
    }
    const original = readFileSync(entryPath, 'utf8');
    const rewritten = original.replace(
      /\br#([A-Za-z_][A-Za-z0-9_]*)/g,
      (raw, identifier: string) => (RUST_KEYWORDS.has(identifier) ? raw : identifier),
    );
    if (rewritten !== original) {
      writeFileSync(entryPath, rewritten);
    }
  }
}

const scratchDirectory = mkdtempSync(resolve(tmpdir(), 'accrue-kamino-'));
try {
  codama.accept(
    renderRustVisitor(scratchDirectory, {
      formatCode: false,
      deleteFolderBeforeRendering: true,
    }),
  );

  rmSync(generatedDirectory, { recursive: true, force: true });
  cpSync(resolve(scratchDirectory, 'src/generated'), generatedDirectory, {
    recursive: true,
  });
  removeRawIdentifiersFromModuleDeclarations(generatedDirectory);
} finally {
  rmSync(scratchDirectory, { recursive: true, force: true });
}

console.log(
  `Generated ${KAMINO_INSTRUCTIONS_WE_CALL.length} Kamino instruction builders into ${generatedDirectory}`,
);
