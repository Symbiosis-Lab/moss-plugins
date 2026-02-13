/**
 * NIP-07 Browser Extension Signer
 *
 * Uses window.nostr provided by browser extensions like Alby, nos2x, etc.
 */

import type {
  Signer,
  SignerType,
  UnsignedEvent,
  SignedEvent,
  WindowWithNostr,
} from "./types";

/**
 * Signer that uses NIP-07 browser extension
 */
export class Nip07Signer implements Signer {
  /**
   * Check if NIP-07 extension is available
   */
  async isAvailable(): Promise<boolean> {
    if (typeof window === "undefined") {
      return false;
    }
    return !!(window as WindowWithNostr).nostr;
  }

  /**
   * Get signer type
   */
  getType(): SignerType {
    return "nip07";
  }

  /**
   * Get the user's public key from the extension
   */
  async getPublicKey(): Promise<string> {
    const nostr = this.getNostrExtension();
    return nostr.getPublicKey();
  }

  /**
   * Sign an event using the extension
   */
  async signEvent(event: UnsignedEvent): Promise<SignedEvent> {
    const nostr = this.getNostrExtension();
    return nostr.signEvent(event);
  }

  /**
   * Get the nostr extension or throw if not available
   */
  private getNostrExtension() {
    if (typeof window === "undefined") {
      throw new Error("NIP-07 extension not available");
    }

    const nostr = (window as WindowWithNostr).nostr;
    if (!nostr) {
      throw new Error("NIP-07 extension not available");
    }

    return nostr;
  }
}
