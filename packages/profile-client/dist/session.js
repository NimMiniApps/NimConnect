const AUTH_SCOPES = new Set([
    'friends:read', 'friends:write', 'inbox:read', 'inbox:send', 'inbox:delete',
    'profile:write', 'backup:read', 'backup:write', 'marketplace:read', 'marketplace:trade',
]);
export function authorizationMessage(input) {
    if (!/^[a-z0-9][a-z0-9_-]{1,31}$/.test(input.audience))
        throw new Error('invalid audience');
    if (!input.scopes.length)
        throw new Error('scopes required');
    const seen = new Set();
    for (const scope of input.scopes) {
        if (!AUTH_SCOPES.has(scope))
            throw new Error(`unknown scope: ${scope}`);
        if (seen.has(scope))
            throw new Error(`duplicate scope: ${scope}`);
        seen.add(scope);
    }
    const scopes = [...input.scopes].sort();
    const compact = input.address.replace(/\s+/g, '').toUpperCase();
    return `NimConnect authorization v3\nApp: ${input.audience}\nAddress: ${compact}\nAccess: ${scopes.join(', ')}\nExpires: ${input.expiresAt}\nNonce: ${input.nonce}`;
}
export function userSessionChallenge(address, timestamp, audience) {
    const compact = address.replace(/\s+/g, '').toUpperCase();
    return `nimconnect-session:v2:${compact}:${timestamp}:${audience}`;
}
/** Legacy v1 challenge — empty-audience compatibility path on the backend. */
export function userSessionChallengeV1(address, timestamp) {
    const compact = address.replace(/\s+/g, '').toUpperCase();
    return `nimconnect-session:v1:${compact}:${timestamp}`;
}
