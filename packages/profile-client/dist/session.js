/** Matches NimConnect backend `userSessionChallenge` / `compactAddress`. */
export function userSessionChallenge(address, timestamp) {
    const compact = address.replace(/\s+/g, '').toUpperCase();
    return `nimconnect-session:v1:${compact}:${timestamp}`;
}
