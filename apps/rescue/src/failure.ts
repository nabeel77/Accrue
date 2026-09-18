import { getAccrueErrorMessage, type AccrueError } from '@accrue/solana/program';

const BASE58_RUN = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/gu;
const ERROR_NUMBER = /Error Number:\s*(\d+)/u;
const ANCHOR_CODE = /error_code_number:\s*(\d+)/u;
const ANCHOR_NAME = /error_name:\s*"([A-Za-z]+)"/u;

function everythingInIt(failure: unknown): string {
  if (failure instanceof Error) {
    const cause = failure.cause === undefined ? '' : ` ${everythingInIt(failure.cause)}`;
    let extra = '';
    try {
      extra = JSON.stringify(failure, Object.getOwnPropertyNames(failure));
    } catch {
      extra = '';
    }
    return `${failure.message}${cause} ${extra}`;
  }
  try {
    return JSON.stringify(failure);
  } catch {
    return String(failure);
  }
}

export function shortenAddresses(text: string): string {
  return text.replace(BASE58_RUN, (one) => `${one.slice(0, 4)}…${one.slice(-4)}`);
}

// The program says which of its own checks refused, and that is the only useful thing to show.
function readable(text: string): string {
  let widened = text;
  for (let round = 0; round < 2; round += 1) {
    try {
      widened = decodeURIComponent(widened.replace(/\+/gu, ' '));
    } catch {
      break;
    }
  }
  try {
    const encoded = /'([A-Za-z0-9+/=]{40,})'/u.exec(widened)?.[1];
    return encoded === undefined
      ? widened
      : `${widened} ${decodeURIComponent(atob(encoded))}`;
  } catch {
    return widened;
  }
}

export function whyItFailed(failure: unknown): string {
  const everything = readable(everythingInIt(failure));
  const named = ANCHOR_NAME.exec(everything);
  if (named !== null) {
    return `the lending market refused it: ${named[1] ?? ''}`;
  }
  const anchorCode = ANCHOR_CODE.exec(everything);
  const numbered = ERROR_NUMBER.exec(everything) ?? anchorCode;
  if (numbered !== null) {
    const code = Number(numbered[1]) as AccrueError;
    const named = getAccrueErrorMessage(code);
    if (named !== '') {
      return named;
    }
  }
  const message = failure instanceof Error ? failure.message : String(failure);
  return shortenAddresses(message);
}
