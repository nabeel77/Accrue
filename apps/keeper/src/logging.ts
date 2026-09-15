const KEPT_AT_EACH_END = 4;

export function shortenAddress(address: string): string {
  if (address.length <= KEPT_AT_EACH_END * 2) {
    return address;
  }
  return `${address.slice(0, KEPT_AT_EACH_END)}…${address.slice(-KEPT_AT_EACH_END)}`;
}

export function reportLine(parts: readonly string[]): string {
  return parts.join(' ');
}
