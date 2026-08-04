/** Matches NimConnect backend `userSessionChallenge` / `compactAddress`. */
export function userSessionChallenge(
  address: string,
  timestamp: number,
  audience: string,
): string {
  const compact = address.replace(/\s+/g, '').toUpperCase()
  return `nimconnect-session:v2:${compact}:${timestamp}:${audience}`
}

/** Legacy v1 challenge — empty-audience compatibility path on the backend. */
export function userSessionChallengeV1(address: string, timestamp: number): string {
  const compact = address.replace(/\s+/g, '').toUpperCase()
  return `nimconnect-session:v1:${compact}:${timestamp}`
}
