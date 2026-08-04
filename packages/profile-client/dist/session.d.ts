/** Matches NimConnect backend `userSessionChallenge` / `compactAddress`. */
export declare function userSessionChallenge(address: string, timestamp: number, audience: string): string;
/** Legacy v1 challenge — empty-audience compatibility path on the backend. */
export declare function userSessionChallengeV1(address: string, timestamp: number): string;
