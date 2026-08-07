import { describe, it, expect, vi, afterEach } from 'vitest';
import { createProfileClient } from './client.js';
afterEach(() => {
    vi.unstubAllGlobals();
});
describe('listAuthorizations', () => {
    it('requires a first-party session and sends X-NimConnect-Session', async () => {
        const client = createProfileClient({ baseUrl: 'https://nc.example' });
        await expect(client.listAuthorizations()).rejects.toThrow(/session/);
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                authorizations: [{
                        audience: 'nimworld',
                        display_name: 'NimWorld',
                        icon_url: 'https://example.test/icon.png',
                        verified: true,
                        scopes: ['friends:read'],
                        granted_at: 1700000000,
                        expires_at: 1700604800,
                    }],
            }),
        });
        vi.stubGlobal('fetch', fetchMock);
        const grants = await createProfileClient({
            baseUrl: 'https://nc.example',
            sessionToken: 'first-party',
        }).listAuthorizations();
        expect(grants).toEqual([{
                audience: 'nimworld',
                displayName: 'NimWorld',
                iconUrl: 'https://example.test/icon.png',
                verified: true,
                scopes: ['friends:read'],
                grantedAt: 1700000000,
                expiresAt: 1700604800,
            }]);
        expect(fetchMock).toHaveBeenCalledWith('https://nc.example/api/authorizations', expect.objectContaining({
            headers: expect.objectContaining({ 'X-NimConnect-Session': 'first-party' }),
        }));
    });
    it('keeps first-party session available after createAuthorization', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                challenge_id: 'c1', message: 'msg', address: 'NQ17 TEST', audience: 'nimworld',
                scopes: ['achievements:read'], expires_at: 1700000300,
            }),
        })
            .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                token: 'scoped-token', address: 'NQ17 TEST', audience: 'nimworld',
                scopes: ['achievements:read'], expires_at: 1700604800,
            }),
        })
            .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ authorizations: [] }),
        });
        vi.stubGlobal('fetch', fetchMock);
        const client = createProfileClient({
            baseUrl: 'https://nc.example',
            audience: 'nimworld',
            sessionToken: 'first-party',
        });
        await client.createAuthorization({
            address: 'NQ17 TEST',
            scopes: ['achievements:read'],
            signMessage: async () => ({ publicKey: 'aa', signature: 'bb' }),
        });
        await client.listAuthorizations();
        expect(fetchMock).toHaveBeenLastCalledWith('https://nc.example/api/authorizations', expect.objectContaining({
            headers: expect.objectContaining({ 'X-NimConnect-Session': 'first-party' }),
        }));
    });
});
describe('listAchievements', () => {
    it('reads public achievements without auth', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                achievements: [{
                        app_id: 'nimworld',
                        achievement_id: 'first-win',
                        address: 'NQ01TEST',
                        title: 'First Win',
                        description: 'Won once',
                        rarity: 'common',
                        visibility: 'public',
                        granted_at: 1700000000,
                        progress: { current: 1, total: 1 },
                    }],
            }),
        });
        vi.stubGlobal('fetch', fetchMock);
        const list = await createProfileClient({ baseUrl: 'https://nc.example' })
            .listAchievements('NQ01 TEST');
        expect(list).toEqual([{
                appId: 'nimworld',
                achievementId: 'first-win',
                address: 'NQ01TEST',
                title: 'First Win',
                description: 'Won once',
                rarity: 'common',
                visibility: 'public',
                grantedAt: 1700000000,
                progress: { current: 1, total: 1 },
            }]);
        expect(fetchMock).toHaveBeenCalledWith('https://nc.example/api/profiles/NQ01TEST/achievements', expect.objectContaining({
            headers: { Accept: 'application/json' },
        }));
    });
    it('sends bearer token when a scoped grant is present', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ achievements: [] }),
        });
        vi.stubGlobal('fetch', fetchMock);
        await createProfileClient({
            baseUrl: 'https://nc.example',
            audience: 'nimworld',
            authorization: {
                token: 'scoped-token',
                address: 'NQ01 TEST',
                audience: 'nimworld',
                scopes: ['achievements:read'],
                expiresAt: 1700604800,
            },
        }).listAchievements('NQ01 TEST');
        expect(fetchMock).toHaveBeenCalledWith('https://nc.example/api/profiles/NQ01TEST/achievements', expect.objectContaining({
            headers: expect.objectContaining({ Authorization: 'Bearer scoped-token' }),
        }));
    });
});
describe('getApp', () => {
    it('returns mirrored catalog identity for consent screens', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                audience: 'nimworld',
                display_name: 'NimWorld',
                icon_url: 'https://example.test/icon.png',
                verified: true,
                scopes: ['friends:read', 'achievements:read'],
                origins: ['https://nimworld.example'],
            }),
        });
        vi.stubGlobal('fetch', fetchMock);
        const app = await createProfileClient({ baseUrl: 'https://nc.example' }).getApp('nimworld');
        expect(app).toEqual({
            audience: 'nimworld',
            displayName: 'NimWorld',
            iconUrl: 'https://example.test/icon.png',
            verified: true,
            scopes: ['friends:read', 'achievements:read'],
            origins: ['https://nimworld.example'],
        });
        expect(fetchMock).toHaveBeenCalledWith('https://nc.example/api/apps/nimworld', expect.objectContaining({ headers: { Accept: 'application/json' } }));
    });
    it('returns null when the app is unknown', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
        const client = createProfileClient({ baseUrl: 'https://nc.example' });
        expect(await client.getApp('missing')).toBeNull();
    });
});
