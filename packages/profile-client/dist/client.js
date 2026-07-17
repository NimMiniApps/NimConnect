/** Strip spaces and uppercase, matching NimConnect backend's `compactAddress`. */
export function compactAddress(address) {
    return address.replace(/\s+/g, '').toUpperCase();
}
/** Production API origin (SPA is on nimconnect.nimiqminiapps.com; API is separate). */
export const DEFAULT_BASE_URL = 'https://api-nimconnect.nimiqminiapps.com';
export function createProfileClient(options = {}) {
    const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    async function getProfileByAddress(address) {
        const res = await fetch(`${baseUrl}/api/profile/${compactAddress(address)}`, {
            headers: { Accept: 'application/json' },
        });
        if (res.status === 404)
            return null;
        if (!res.ok)
            throw new Error(`profile fetch failed: ${res.status}`);
        const body = await res.json();
        return {
            address: body.address,
            updatedAt: body.updated_at,
            profile: body.profile ?? {},
        };
    }
    function parseHandleClaim(body) {
        return {
            handle: body.handle,
            address: body.address,
            txHash: body.tx_hash,
            blockHeight: body.block_height,
            txIndex: body.tx_index,
        };
    }
    async function resolveHandle(handle) {
        const res = await fetch(`${baseUrl}/api/resolve/${handle}`, {
            headers: { Accept: 'application/json' },
        });
        if (res.status === 404)
            return null;
        if (!res.ok)
            throw new Error(`resolve handle failed: ${res.status}`);
        return parseHandleClaim(await res.json());
    }
    async function getHandleByAddress(address) {
        const res = await fetch(`${baseUrl}/api/handles/by-address/${compactAddress(address)}`, {
            headers: { Accept: 'application/json' },
        });
        if (res.status === 404)
            return null;
        if (!res.ok)
            throw new Error(`handle by address fetch failed: ${res.status}`);
        return parseHandleClaim(await res.json());
    }
    async function getDisplayIdentity(address) {
        // allSettled: a 5xx/network failure on one side must not discard the other.
        const [handleResult, profileResult] = await Promise.allSettled([
            getHandleByAddress(address),
            getProfileByAddress(address),
        ]);
        const handleClaim = handleResult.status === 'fulfilled' ? handleResult.value : null;
        const storedProfile = profileResult.status === 'fulfilled' ? profileResult.value : null;
        const profile = storedProfile?.profile;
        return {
            address,
            handle: handleClaim?.handle,
            displayName: profile?.display_name,
            bio: profile?.bio,
            links: profile
                ? { website: profile.website, github: profile.github, x: profile.x }
                : undefined,
        };
    }
    return { getProfileByAddress, resolveHandle, getHandleByAddress, getDisplayIdentity };
}
