/**
 * Signer abstraction layer
 *
 * Provides a unified interface for different identity providers:
 * - NIP-07 browser extensions
 * - NIP-46 remote signers (Moss app)
 * - Host iframe signers (signer.moss.host)
 * - Local fallback (IndexedDB)
 */

import { generateSecretKey } from "nostr-tools";
import type { Signer } from "./types";
import { Nip07Signer } from "./nip07";
import { LocalSigner } from "./local";

// Re-export types and implementations
export type { Signer, SignerType, UnsignedEvent, SignedEvent } from "./types";
export { Nip07Signer } from "./nip07";
export { LocalSigner } from "./local";

/**
 * Resolves the best available signer based on priority:
 * 1. NIP-07 extension
 * 2. NIP-46 connection (TODO)
 * 3. Host iframe (TODO)
 * 4. Local fallback
 */
export class SignerResolver {
  /**
   * Resolve the best available signer
   */
  async resolve(): Promise<Signer> {
    // Priority 1: NIP-07 browser extension
    const nip07 = new Nip07Signer();
    if (await nip07.isAvailable()) {
      return nip07;
    }

    // Priority 2: NIP-46 connection (TODO: implement)
    // const nip46Connection = localStorage.getItem('moss_nip46_connection');
    // if (nip46Connection) { ... }

    // Priority 3: Host iframe signer (TODO: implement)
    // const hostOrigin = localStorage.getItem('moss_signer_origin');
    // if (hostOrigin) { ... }

    // Priority 4: Local fallback - check for existing key or generate new
    const localKey = await this.getOrCreateLocalKey();
    return new LocalSigner(localKey.key, {
      showUpgradePrompt: true,
      isNew: localKey.isNew,
    });
  }

  /**
   * Get existing local key or create a new one
   */
  private async getOrCreateLocalKey(): Promise<{
    key: Uint8Array;
    isNew: boolean;
  }> {
    // In browser, this would check IndexedDB
    // For now, generate a new key
    // TODO: Implement IndexedDB storage
    const key = generateSecretKey();
    return { key, isNew: true };
  }
}

/**
 * Convenience function to get a signer
 */
export async function getSigner(): Promise<Signer> {
  const resolver = new SignerResolver();
  return resolver.resolve();
}
