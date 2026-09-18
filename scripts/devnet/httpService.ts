import type { IncomingMessage, ServerResponse } from 'node:http';

const LARGEST_BODY_BYTES = 4_096;

export function answer(response: ServerResponse, status: number, body: unknown): void {
  const encoded = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(encoded),
  });
  response.end(encoded);
}

export async function readBody(request: IncomingMessage): Promise<string> {
  const pieces: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const piece = Buffer.from(chunk as Buffer);
    pieces.push(piece);
    length += piece.length;
    if (length > LARGEST_BODY_BYTES) {
      throw new Error('that request body is too long');
    }
  }
  return Buffer.concat(pieces).toString('utf8');
}

export function callerHost(request: IncomingMessage): string {
  const forwarded = request.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
  return (first ?? request.socket.remoteAddress ?? 'unknown').trim();
}

export function theSharedSecret(): string {
  return process.env['DEVNET_FAUCET_SECRET'] ?? '';
}

// The shared secret is what the web app's server side sends. Without one set, nothing is served.
export function theSecretMatches(request: IncomingMessage): boolean {
  const expected = theSharedSecret();
  if (expected === '') {
    return false;
  }
  const given = request.headers['x-faucet-secret'];
  return typeof given === 'string' && given === expected;
}
