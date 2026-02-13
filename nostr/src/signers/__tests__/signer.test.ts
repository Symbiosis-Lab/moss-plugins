/**
 * Tests for Signer abstraction layer
 *
 * Following TDD: Write test first, watch it fail, implement minimal code.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";

// Import types (will create these)
import type { Signer, SignerType, UnsignedEvent, SignedEvent } from "../types";

// Import implementations (will create these)
import { Nip07Signer } from "../nip07";
import { LocalSigner } from "../local";
import { getSigner, SignerResolver } from "../index";

describe("Signer interface", () => {
  describe("SignerType", () => {
    test("should include all four signer types", () => {
      const types: SignerType[] = ["nip07", "nip46", "iframe", "local"];
      expect(types).toHaveLength(4);
    });
  });

  describe("UnsignedEvent", () => {
    test("should have required fields for Nostr event", () => {
      const event: UnsignedEvent = {
        kind: 1,
        content: "Hello world",
        tags: [],
        created_at: Math.floor(Date.now() / 1000),
      };

      expect(event.kind).toBe(1);
      expect(event.content).toBe("Hello world");
      expect(event.tags).toEqual([]);
      expect(typeof event.created_at).toBe("number");
    });
  });
});

describe("Nip07Signer", () => {
  beforeEach(() => {
    // Reset window.nostr mock
    vi.stubGlobal("window", {
      nostr: undefined,
    });
  });

  test("isAvailable returns false when window.nostr is undefined", async () => {
    const signer = new Nip07Signer();
    const available = await signer.isAvailable();
    expect(available).toBe(false);
  });

  test("isAvailable returns true when window.nostr exists", async () => {
    vi.stubGlobal("window", {
      nostr: {
        getPublicKey: vi.fn(),
        signEvent: vi.fn(),
      },
    });

    const signer = new Nip07Signer();
    const available = await signer.isAvailable();
    expect(available).toBe(true);
  });

  test("getType returns 'nip07'", () => {
    const signer = new Nip07Signer();
    expect(signer.getType()).toBe("nip07");
  });

  test("getPublicKey calls window.nostr.getPublicKey", async () => {
    const mockPubkey = "npub1abc123";
    vi.stubGlobal("window", {
      nostr: {
        getPublicKey: vi.fn().mockResolvedValue(mockPubkey),
        signEvent: vi.fn(),
      },
    });

    const signer = new Nip07Signer();
    const pubkey = await signer.getPublicKey();
    expect(pubkey).toBe(mockPubkey);
  });

  test("signEvent calls window.nostr.signEvent with unsigned event", async () => {
    const unsignedEvent: UnsignedEvent = {
      kind: 1,
      content: "Test",
      tags: [],
      created_at: 1234567890,
    };

    const signedEvent: SignedEvent = {
      ...unsignedEvent,
      id: "event123",
      pubkey: "pubkey123",
      sig: "sig123",
    };

    vi.stubGlobal("window", {
      nostr: {
        getPublicKey: vi.fn(),
        signEvent: vi.fn().mockResolvedValue(signedEvent),
      },
    });

    const signer = new Nip07Signer();
    const result = await signer.signEvent(unsignedEvent);

    expect(result).toEqual(signedEvent);
    expect((window as any).nostr.signEvent).toHaveBeenCalledWith(unsignedEvent);
  });

  test("throws error when window.nostr is not available", async () => {
    const signer = new Nip07Signer();

    await expect(signer.getPublicKey()).rejects.toThrow(
      "NIP-07 extension not available"
    );
  });
});

describe("LocalSigner", () => {
  // Use a fixed test private key (32 bytes hex)
  const testPrivateKey = new Uint8Array(32).fill(1);

  test("getType returns 'local'", () => {
    const signer = new LocalSigner(testPrivateKey);
    expect(signer.getType()).toBe("local");
  });

  test("isAvailable always returns true", async () => {
    const signer = new LocalSigner(testPrivateKey);
    const available = await signer.isAvailable();
    expect(available).toBe(true);
  });

  test("getPublicKey derives public key from private key", async () => {
    const signer = new LocalSigner(testPrivateKey);
    const pubkey = await signer.getPublicKey();

    // Should return a hex string (64 chars for 32 bytes)
    expect(typeof pubkey).toBe("string");
    expect(pubkey.length).toBe(64);
  });

  test("signEvent returns signed event with id, pubkey, and sig", async () => {
    const signer = new LocalSigner(testPrivateKey);

    const unsignedEvent: UnsignedEvent = {
      kind: 1,
      content: "Test message",
      tags: [],
      created_at: 1234567890,
    };

    const signedEvent = await signer.signEvent(unsignedEvent);

    // Should have all unsigned fields
    expect(signedEvent.kind).toBe(1);
    expect(signedEvent.content).toBe("Test message");
    expect(signedEvent.tags).toEqual([]);
    expect(signedEvent.created_at).toBe(1234567890);

    // Should have added id, pubkey, sig
    expect(typeof signedEvent.id).toBe("string");
    expect(typeof signedEvent.pubkey).toBe("string");
    expect(typeof signedEvent.sig).toBe("string");

    // ID should be 64 chars (32 bytes hex)
    expect(signedEvent.id.length).toBe(64);
    // Signature should be 128 chars (64 bytes hex)
    expect(signedEvent.sig.length).toBe(128);
  });

  test("showUpgradePrompt option is accessible", () => {
    const signer = new LocalSigner(testPrivateKey, { showUpgradePrompt: true });
    expect(signer.shouldShowUpgradePrompt()).toBe(true);

    const signer2 = new LocalSigner(testPrivateKey);
    expect(signer2.shouldShowUpgradePrompt()).toBe(false);
  });
});

describe("SignerResolver", () => {
  beforeEach(() => {
    // Reset mocks
    vi.stubGlobal("window", {
      nostr: undefined,
    });
    vi.stubGlobal("localStorage", {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
    });
  });

  test("returns Nip07Signer when window.nostr is available", async () => {
    vi.stubGlobal("window", {
      nostr: {
        getPublicKey: vi.fn(),
        signEvent: vi.fn(),
      },
    });

    const resolver = new SignerResolver();
    const signer = await resolver.resolve();

    expect(signer.getType()).toBe("nip07");
  });

  test("returns LocalSigner as fallback when no other signers available", async () => {
    const resolver = new SignerResolver();
    const signer = await resolver.resolve();

    // Should fall back to local signer
    expect(signer.getType()).toBe("local");
  });

  test("getSigner convenience function works", async () => {
    const signer = await getSigner();
    expect(signer).toBeDefined();
    expect(typeof signer.getType).toBe("function");
  });
});
