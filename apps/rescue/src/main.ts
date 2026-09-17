import { address, type Address } from '@solana/kit';

import {
  buildRescue,
  CLUSTERS,
  positionsOwnedBy,
  rpcFor,
  shorten,
  signAndSend,
  type ClusterChoice,
  type RescuablePosition,
} from './chain.js';
import { RESCUE_COPY } from './copy.js';
import {
  connectFirstWallet,
  signTransaction,
  type StandardAccount,
  type StandardWallet,
} from './wallet.js';

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (found === null) {
    throw new Error(`the page has no ${id}`);
  }
  return found;
}

const title = element('title');
const intro = element('intro');
const clusterLabel = element('cluster-label');
const endpointLabel = element('endpoint-label');
const cluster = element('cluster') as HTMLSelectElement;
const endpoint = element('endpoint') as HTMLInputElement;
const connect = element('connect') as HTMLButtonElement;
const status = element('status');
const positions = element('positions');

title.textContent = RESCUE_COPY.title;
intro.textContent = RESCUE_COPY.intro;
clusterLabel.textContent = RESCUE_COPY.clusterLabel;
endpointLabel.textContent = RESCUE_COPY.endpointLabel;
connect.textContent = RESCUE_COPY.connect;

let chosen: ClusterChoice = 'devnet';
endpoint.value = CLUSTERS[chosen].endpoint;

let wallet: StandardWallet | null = null;
let account: StandardAccount | null = null;

cluster.addEventListener('change', () => {
  chosen = cluster.value === 'mainnet' ? 'mainnet' : 'devnet';
  endpoint.value = CLUSTERS[chosen].endpoint;
  positions.replaceChildren();
  if (account !== null) {
    void listPositions();
  }
});

connect.addEventListener('click', () => {
  void connectAndList();
});

async function connectAndList(): Promise<void> {
  connect.disabled = true;
  connect.textContent = RESCUE_COPY.connecting;
  try {
    const connected = await connectFirstWallet();
    if (connected === null) {
      status.textContent = RESCUE_COPY.noWallet;
      connect.textContent = RESCUE_COPY.connect;
      return;
    }
    wallet = connected.wallet;
    account = connected.account;
    connect.textContent = shorten(account.address);
    await listPositions();
  } finally {
    connect.disabled = false;
  }
}

async function listPositions(): Promise<void> {
  if (account === null) {
    return;
  }
  status.textContent = RESCUE_COPY.reading;
  positions.replaceChildren();
  try {
    const owner = address(account.address);
    const found = await positionsOwnedBy(rpcFor(endpoint.value), owner);
    status.textContent = '';
    if (found.length === 0) {
      status.textContent = RESCUE_COPY.none;
      return;
    }
    for (const position of found) {
      positions.append(cardFor(position, owner));
    }
  } catch {
    status.textContent = RESCUE_COPY.failed;
  }
}

function labelled(label: string, value: string): HTMLDivElement {
  const line = document.createElement('div');
  line.className = 'line';
  const left = document.createElement('label');
  left.textContent = label;
  const right = document.createElement('span');
  right.className = 'mono';
  right.textContent = value;
  line.append(left, right);
  return line;
}

function cardFor(position: RescuablePosition, owner: Address): HTMLDivElement {
  const card = document.createElement('div');
  card.className = 'panel';
  card.dataset['testid'] = `position-${position.address}`;

  card.append(
    labelled(RESCUE_COPY.positionLabel, shorten(position.address)),
    labelled(RESCUE_COPY.collateralLabel, shorten(position.collateralMint)),
    labelled(RESCUE_COPY.destinationLabel, shorten(position.destinationMint)),
    labelled(RESCUE_COPY.stateLabel, position.state),
  );

  const line = document.createElement('p');
  line.className = 'status';
  line.dataset['testid'] = 'rescue-state';

  const button = document.createElement('button');
  button.textContent = RESCUE_COPY.button;
  button.dataset['testid'] = 'rescue';
  button.addEventListener('click', () => {
    void rescue(position, owner, button, line, card);
  });

  card.append(button, line);
  return card;
}

async function rescue(
  position: RescuablePosition,
  owner: Address,
  button: HTMLButtonElement,
  line: HTMLParagraphElement,
  card: HTMLDivElement,
): Promise<void> {
  if (wallet === null || account === null) {
    return;
  }
  button.disabled = true;
  button.textContent = RESCUE_COPY.working;
  const signingWallet = wallet;
  const signingAccount = account;
  try {
    const rpc = rpcFor(endpoint.value);
    const plan = await buildRescue(rpc, CLUSTERS[chosen], owner, position.address);
    const sign = (unsigned: Uint8Array): Promise<Uint8Array> =>
      signTransaction(signingWallet, signingAccount, unsigned);

    const signature = await signAndSend(rpc, owner, plan.rescue, sign);
    const shown = labelled(RESCUE_COPY.signatureLabel, shorten(signature));
    shown.dataset['testid'] = 'rescue-signature';
    shown.title = signature;
    card.append(shown);
    line.textContent = RESCUE_COPY.returned;

    // The tokens are already back, so a loan that cannot be settled is reported and nothing else.
    try {
      for (const step of plan.settle) {
        await signAndSend(rpc, owner, step, sign);
      }
      line.textContent = RESCUE_COPY.done;
    } catch {
      line.textContent =
        plan.stillOwedUsdc === null
          ? RESCUE_COPY.returned
          : RESCUE_COPY.stillOwed(plan.stillOwedUsdc);
    }
  } catch {
    line.textContent = RESCUE_COPY.failed;
  } finally {
    button.disabled = false;
    button.textContent = RESCUE_COPY.button;
  }
}
