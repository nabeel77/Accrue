export interface KeeperConfiguration {
  rpcUrl: string;
  /** A path on the keeper machine. The key is read from the file, never from a variable. */
  keypairPath: string;
  programAddress: string;
  jupiterApiUrl: string;
  intervalSeconds: number;
  priorityFeeLamports: number;
}

function requireVariable(variableName: string): string {
  const value = process.env[variableName];
  if (!value) {
    throw new Error(`${variableName} is not set. See .env.example.`);
  }
  return value;
}

function requirePositiveInteger(variableName: string): number {
  const raw = requireVariable(variableName);
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${variableName} must be a positive whole number.`);
  }
  return parsed;
}

export function readKeeperConfiguration(): KeeperConfiguration {
  return {
    rpcUrl: requireVariable('KEEPER_RPC_URL'),
    keypairPath: requireVariable('KEEPER_KEYPAIR_PATH'),
    programAddress: requireVariable('ACCRUE_PROGRAM_ID'),
    jupiterApiUrl: requireVariable('JUPITER_API_URL'),
    intervalSeconds: requirePositiveInteger('KEEPER_INTERVAL_SECONDS'),
    priorityFeeLamports: requirePositiveInteger('KEEPER_PRIORITY_FEE_LAMPORTS'),
  };
}
