import { readKeeperConfiguration } from './config.js';

/**
 * The guard loop arrives in Phase 2. Today this only proves the service starts from the
 * environment alone, and that nothing it prints names a key, a path or an address.
 */
function main(): void {
  const configuration = readKeeperConfiguration();
  console.log(
    `keeper ready, polling every ${configuration.intervalSeconds}s, priority fee ${configuration.priorityFeeLamports} lamports`,
  );
}

main();
