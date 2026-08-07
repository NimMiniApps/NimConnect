import type { Achievement, AppAuthorization, DisplayIdentity, AuthScope, AuthSession, FriendEntry, HandleClaim, ProfileClientOptions, RegisteredApp, SignMessageFn, StoredPublicProfile } from './types.js';
/** Strip spaces and uppercase, matching NimConnect backend's `compactAddress`. */
export declare function compactAddress(address: string): string;
/** Production API origin (SPA is on nimconnect.nimiqminiapps.com; API is separate). */
export declare const DEFAULT_BASE_URL = "https://api-nimconnect.nimiqminiapps.com";
export interface ProfileClient {
    getProfileByAddress(address: string): Promise<StoredPublicProfile | null>;
    resolveHandle(handle: string): Promise<HandleClaim | null>;
    resolveHandleForPayment(handle: string): Promise<HandleClaim | null>;
    getHandleByAddress(address: string): Promise<HandleClaim | null>;
    getDisplayIdentity(address: string): Promise<DisplayIdentity>;
    getApp(audience: string): Promise<RegisteredApp | null>;
    createSession(args: {
        address: string;
        signMessage: SignMessageFn;
    }): Promise<{
        token: string;
        expiresAt: number;
    }>;
    clearSession(): void;
    getSessionToken(): string | null;
    createAuthorization(args: {
        address: string;
        scopes: AuthScope[];
        signMessage: SignMessageFn;
    }): Promise<AuthSession>;
    getAuthorization(): AuthSession | null;
    revokeAuthorization(all?: boolean): Promise<void>;
    listAuthorizations(): Promise<AppAuthorization[]>;
    listAchievements(address: string): Promise<Achievement[]>;
    listFriends(): Promise<FriendEntry[]>;
    listFriendRequests(): Promise<FriendEntry[]>;
    sendFriendRequest(to: string): Promise<FriendEntry>;
    acceptFriendRequest(id: string): Promise<void>;
    declineFriendRequest(id: string): Promise<void>;
    removeFriend(address: string): Promise<void>;
}
export declare function createProfileClient(options?: ProfileClientOptions): ProfileClient;
