export async function register(): Promise<void> {
  if (process.env['NEXT_RUNTIME'] !== 'nodejs') {
    return;
  }
  const { everyCapIsWithinItsCeiling } = await import('./server/env.js');
  everyCapIsWithinItsCeiling();
}
