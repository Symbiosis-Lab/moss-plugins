/**
 * Local Signer
 *
 * Uses a private key stored in the browser's IndexedDB.
 * This is the fallback signer when no other options are available.
 */

import { getPublicKey, finalizeEvent } from "nostr-tools";
import type {
  Signer,
  SignerType,
  UnsignedEvent,
  SignedEvent,
  LocalSignerOptions,
} from "./types";

/**
 * Signer that uses a locally stored private key
 */
export class LocalSigner implements Signer {
  private privateKey: Uint8Array;
  private options: LocalSignerOptions;

  constructor(privateKey: Uint8Array, options: LocalSignerOptions = {}) {
    this.privateKey = privateKey;
    this.options = options;
  }

  /**
   * Local signer is always available if we have the key
   */
  async isAvailable(): Promise<boolean> {
    return true;
  }

  /**
   * Get signer type
   */
  getType(): SignerType {
    return "local";
  }

  /**
   * Get the public key derived from the private key
   */
  async getPublicKey(): Promise<string> {
    return getPublicKey(this.privateKey);
  }

  /**
   * Sign an event with the local private key
   */
  async signEvent(event: UnsignedEvent): Promise<SignedEvent> {
    // finalizeEvent adds id, pubkey, and sig
    const signedEvent = finalizeEvent(event, this.privateKey);
    return signedEvent as SignedEvent;
  }

  /**
   * Check if upgrade prompt should be shown
   */
  shouldShowUpgradePrompt(): boolean {
    return this.options.showUpgradePrompt ?? false;
  }

  /**
   * Check if this is a newly generated key
   */
  isNewKey(): boolean {
    return this.options.isNew ?? false;
  }
}
