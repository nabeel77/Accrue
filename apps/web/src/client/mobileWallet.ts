'use client';

let offered = false;

export function offerTheMobileWallet(chain: string): void {
  if (offered || typeof window === 'undefined') {
    return;
  }
  offered = true;
  void (async () => {
    try {
      const {
        createDefaultAuthorizationCache,
        createDefaultChainSelector,
        createDefaultWalletNotFoundHandler,
        registerMwa,
      } = await import('@solana-mobile/wallet-standard-mobile');
      registerMwa({
        appIdentity: { name: 'Accrue', uri: window.location.origin },
        authorizationCache: createDefaultAuthorizationCache(),
        chains: [chain as `solana:${string}`],
        chainSelector: createDefaultChainSelector(),
        onWalletNotFound: createDefaultWalletNotFoundHandler(),
      });
    } catch {
      // A browser the protocol cannot run in is not an error, it is a browser with no phone
      // wallet to reach.
      offered = false;
    }
  })();
}
