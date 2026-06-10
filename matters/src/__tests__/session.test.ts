import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the SDK exactly like api.test.ts does (api.ts imports it at module top).
vi.mock("@symbiosis-lab/moss-api", async () => {
  const actual = await vi.importActual("@symbiosis-lab/moss-api");
  return {
    ...actual,
    getPluginCookie: vi.fn(),
    httpPost: vi.fn(),
    pluginFileExists: vi.fn(),
    readPluginFile: vi.fn(),
    writePluginFile: vi.fn(),
  };
});

import { decodeJwtExpiryMs } from "../api";

/** Build an unsigned JWT with the given payload (header/sig are ignored by the decoder). */
function fakeJwt(payload: Record<string, unknown>): string {
  const b64url = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.fakesig`;
}

describe("decodeJwtExpiryMs", () => {
  it("returns exp in milliseconds for a JWT with numeric exp", () => {
    expect(decodeJwtExpiryMs(fakeJwt({ exp: 1777777777, id: "x" }))).toBe(1777777777000);
  });

  it("returns null when exp is missing", () => {
    expect(decodeJwtExpiryMs(fakeJwt({ id: "x" }))).toBeNull();
  });

  it("returns null when exp is not a number", () => {
    expect(decodeJwtExpiryMs(fakeJwt({ exp: "tomorrow" }))).toBeNull();
  });

  it("returns null for a non-JWT opaque token", () => {
    expect(decodeJwtExpiryMs("not-a-jwt-token")).toBeNull();
  });

  it("returns null for a JWT with an undecodable payload", () => {
    expect(decodeJwtExpiryMs("aGVhZGVy.!!!notbase64!!!.sig")).toBeNull();
  });

  it("decodes base64url payloads (- and _ characters, no padding)", () => {
    const jwt = fakeJwt({ exp: 2000000000, u: "??>>" });
    expect(decodeJwtExpiryMs(jwt)).toBe(2000000000000);
  });
});
