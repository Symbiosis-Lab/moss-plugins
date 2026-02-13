/**
 * Signer types for the comment widget
 *
 * These types define the contract for different identity providers.
 */

/**
 * Type of signer being used
 */
export type SignerType = "nip07" | "nip46" | "iframe" | "local";

/**
 * Unsigned Nostr event (before signing)
 */
export interface UnsignedEvent {
  /** Event kind (1 = text note, 30023 = long-form, etc.) */
  kind: number;

  /** Event content */
  content: string;

  /** Event tags (e.g., [["r", "url"], ["t", "topic"]]) */
  tags: string[][];

  /** Unix timestamp in seconds */
  created_at: number;
}

/**
 * Signed Nostr event (after signing)
 */
export interface SignedEvent extends UnsignedEvent {
  /** Event ID (sha256 hash of serialized event) */
  id: string;

  /** Author's public key (hex) */
  pubkey: string;

  /** Schnorr signature (hex) */
  sig: string;
}

/**
 * Signer interface - all signer implementations must conform to this
 */
export interface Signer {
  /** Get the user's public key (hex format) */
  getPublicKey(): Promise<string>;

  /** Sign a Nostr event */
  signEvent(event: UnsignedEvent): Promise<SignedEvent>;

  /** Check if this signer is available/reachable */
  isAvailable(): Promise<boolean>;

  /** Get the signer type for UI display */
  getType(): SignerType;
}

/**
 * Options for local signer
 */
export interface LocalSignerOptions {
  /** Whether to show upgrade prompt after use */
  showUpgradePrompt?: boolean;

  /** Whether this is a newly generated key */
  isNew?: boolean;
}

/**
 * NIP-07 browser extension interface
 */
export interface Nip07Extension {
  getPublicKey(): Promise<string>;
  signEvent(event: UnsignedEvent): Promise<SignedEvent>;
  getRelays?(): Promise<Record<string, { read: boolean; write: boolean }>>;
}

/**
 * Window with optional NIP-07 extension
 */
export interface WindowWithNostr extends Window {
  nostr?: Nip07Extension;
}
