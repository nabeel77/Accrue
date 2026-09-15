import { address, createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit';

import { fetchConfig, findConfigPda } from '@accrue/solana/program';

import { readKeeperConfiguration } from './config.js';
import { createGuardInstructionBuilder } from './guard.js';
import { fetchSwapInstruction } from './jupiter.js';
import { loadFeePayer } from './keypair.js';
import { shortenAddress } from './logging.js';
import { runOneRound, sleep } from './loop.js';
import { createRunLog } from './runs.js';
import { surveyTheProgram } from './survey.js';
import { createSender } from './transaction.js';

async function main(): Promise<void> {
  const configuration = readKeeperConfiguration();
  const feePayer = await loadFeePayer(configuration.keypairPath);
  const rpc = createSolanaRpc(configuration.rpcUrl);
  const rpcSubscriptions = createSolanaRpcSubscriptions(
    configuration.rpcUrl.replace(/^http/u, 'ws'),
  );
  const sender = createSender(
    rpc,
    rpcSubscriptions,
    feePayer,
    configuration.priorityFeeLamports,
  );
  const programAddress = address(configuration.programAddress);
  const [configAddress] = await findConfigPda({ programAddress });
  const runLog = createRunLog();

  console.log(
    `keeper ${shortenAddress(feePayer.address)} watching ${shortenAddress(
      configuration.programAddress,
    )}, every ${configuration.intervalSeconds}s`,
  );

  for (;;) {
    try {
      const config = await fetchConfig(rpc, configAddress);
      const round = await surveyTheProgram(
        rpc,
        programAddress,
        feePayer.address,
        config.data,
      );
      const builder = createGuardInstructionBuilder({
        config: config.data,
        configAddress,
        caller: feePayer,
        askTheRouter: (request) =>
          fetchSwapInstruction(
            configuration.jupiterApiUrl,
            request,
            configuration.jupiterApiKey,
          ),
      });
      const report = await runOneRound(
        round,
        builder,
        (instruction) => sender.send(instruction),
        runLog,
        (line) => {
          console.log(line);
        },
      );
      console.log(
        `${report.considered} watched, ${report.attempted} attempted, ${report.landed} landed`,
      );
    } catch (failure) {
      console.log(
        `round failed: ${failure instanceof Error ? failure.message : 'unknown'}`,
      );
    }
    await sleep(configuration.intervalSeconds);
  }
}

await main();
