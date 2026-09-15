import { readFile } from 'node:fs/promises';

import { createKeyPairSignerFromBytes, type KeyPairSigner } from '@solana/kit';

/**
 * The only key any Accrue service holds. It is read from a path outside the repo, it is never
 * put in an environment variable, and nothing here ever prints it.
 */
export async function loadFeePayer(keypairPath: string): Promise<KeyPairSigner> {
  let secret: number[];
  try {
    secret = JSON.parse(await readFile(keypairPath, 'utf8')) as number[];
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
