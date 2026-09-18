import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

import { createKeyPairSignerFromBytes, type KeyPairSigner } from '@solana/kit';

// A tilde is a shell convention, and nothing expands it for a value read from a file.
function expandHome(path: string): string {
  return path.startsWith('~') ? resolve(homedir(), path.slice(2)) : resolve(path);
}

// The only key any Accrue service holds.
export async function loadFeePayer(keypairPath: string): Promise<KeyPairSigner> {
  let secret: number[];
  try {
    secret = JSON.parse(await readFile(expandHome(keypairPath), 'utf8')) as number[];
  } catch {
    throw new Error(
      'the keeper key could not be read from the path in KEEPER_KEYPAIR_PATH',
    );
  }
  if (!Array.isArray(secret) || secret.length === 0) {
    throw new Error('the file at KEEPER_KEYPAIR_PATH is not a keypair');
  }
  return createKeyPairSignerFromBytes(Uint8Array.from(secret));
}
