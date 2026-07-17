import type { DisplayIdentity, HandleClaim, ProfileClientOptions, StoredPublicProfile } from './types';
/** Strip spaces and uppercase, matching NimConnect backend's `compactAddress`. */
export declare function compactAddress(address: string): string;
/** Production API origin (SPA is on nimconnect.nimiqminiapps.com; API is separate). */
export declare const DEFAULT_BASE_URL = "https://api-nimconnect.nimiqminiapps.com";
export interface ProfileClient {
    getProfileByAddress(address: string): Promise<StoredPublicProfile | null>;
    resolveHandle(handle: string): Promise<HandleClaim | null>;
    getHandleByAddress(address: string): Promise<HandleClaim | null>;
    getDisplayIdentity(address: string): Promise<DisplayIdentity>;
}
export declare function createProfileClient(options?: ProfileClientOptions): ProfileClient;
