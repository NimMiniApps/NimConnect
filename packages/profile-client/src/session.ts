/** Matches NimConnect backend `userSessionChallenge` / `compactAddress`. */
export function userSessionChallenge(address: string, timestamp: number): string {
  const compact = address.replace(/\s+/g, '').toUpperCase()
  return `nimconnect-session:v1:${compact}:${timestamp}`
}
