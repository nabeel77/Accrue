// What the browser tells the server about the wallet that will sign. Version one transactions
// are refused outright by a wallet that predates them, and a wallet that cannot read a
// transaction cannot tell the user what they are signing, so the assembler asks before it
// compiles. Neither side of this is server only or client only, so the name lives here.
export const WALLET_TAKES_VERSION_ONE_HEADER = 'x-wallet-takes-version-one';
