/** Matches NimConnect backend `userSessionChallenge` / `compactAddress`. */
export function userSessionChallenge(address, timestamp, audience) {
    const compact = address.replace(/\s+/g, '').toUpperCase();
    return `nimconnect-session:v2:${compact}:${timestamp}:${audience}`;
}
/** Legacy v1 challenge — empty-audience compatibility path on the backend. */
export function userSessionChallengeV1(address, timestamp) {
    const compact = address.replace(/\s+/g, '').toUpperCase();
    return `nimconnect-session:v1:${compact}:${timestamp}`;
}
