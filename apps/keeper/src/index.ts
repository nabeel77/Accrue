import { readKeeperConfiguration } from './config.js';

function main(): void {
  const configuration = readKeeperConfiguration();
  console.log(
    `keeper ready, polling every ${configuration.intervalSeconds}s, priority fee ${configuration.priorityFeeLamports} lamports`,
  );
}

main();
