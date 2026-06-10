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

import {
  getSessionState,
  markSessionInvalidated,
  shouldNudgeSessionExpired,
  loadStoredToken,
  saveStoredToken,
  clearTokenCache,
} from "../api";
import { pluginFileExists, readPluginFile, writePluginFile } from "@symbiosis-lab/moss-api";

const FUTURE = Math.floor(Date.now() / 1000) + 90 * 24 * 3600;
const PAST = Math.floor(Date.now() / 1000) - 24 * 3600;
const WITHIN_SKEW = Math.floor(Date.now() / 1000) + 30; // < 60s skew margin

function mockAuthFile(record: Record<string, unknown> | null) {
  vi.mocked(pluginFileExists).mockResolvedValue(record !== null);
  vi.mocked(readPluginFile).mockResolvedValue(JSON.stringify(record ?? {}));
}

describe("getSessionState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTokenCache();
  });

  it("returns 'none' when no auth file exists", async () => {
    mockAuthFile(null);
    expect(await getSessionState()).toBe("none");
  });

  it("returns 'none' when the record has no accessToken", async () => {
    mockAuthFile({ savedAt: "2026-01-01" });
    expect(await getSessionState()).toBe("none");
  });

  it("returns 'valid' for an unexpired JWT", async () => {
    mockAuthFile({ accessToken: fakeJwt({ exp: FUTURE }) });
    expect(await getSessionState()).toBe("valid");
  });

  it("returns 'expired' for an expired JWT, with an honest log line", async () => {
    const logSpy = vi.spyOn(console, "log");
    mockAuthFile({ accessToken: fakeJwt({ exp: PAST }) });
    expect(await getSessionState()).toBe("expired");
    expect(logSpy.mock.calls.flat().join("\n")).toContain("EXPIRED");
    logSpy.mockRestore();
  });

  it("returns 'expired' for a JWT expiring within the 60s skew margin", async () => {
    mockAuthFile({ accessToken: fakeJwt({ exp: WITHIN_SKEW }) });
    expect(await getSessionState()).toBe("expired");
  });

  it("returns 'expired' when invalidatedAt is stamped, even if exp is future", async () => {
    mockAuthFile({
      accessToken: fakeJwt({ exp: FUTURE }),
      invalidatedAt: "2026-06-10T03:00:00.000Z",
    });
    expect(await getSessionState()).toBe("expired");
  });

  it("returns 'valid' for an undecodable token (runtime backstop will catch it)", async () => {
    mockAuthFile({ accessToken: "opaque-non-jwt-token" });
    expect(await getSessionState()).toBe("valid");
  });
});

describe("loadStoredToken dead-token filtering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTokenCache();
  });

  it("returns the token for a valid record", async () => {
    const token = fakeJwt({ exp: FUTURE });
    mockAuthFile({ accessToken: token });
    expect(await loadStoredToken()).toBe(token);
  });

  it("returns null for an expired JWT (login flow must not 'find' a dead token)", async () => {
    mockAuthFile({ accessToken: fakeJwt({ exp: PAST }) });
    expect(await loadStoredToken()).toBeNull();
  });

  it("returns null for an invalidatedAt-stamped record", async () => {
    mockAuthFile({
      accessToken: fakeJwt({ exp: FUTURE }),
      invalidatedAt: "2026-06-10T03:00:00.000Z",
    });
    expect(await loadStoredToken()).toBeNull();
  });

  it("returns an opaque non-JWT token unchanged (cannot judge locally)", async () => {
    mockAuthFile({ accessToken: "opaque-non-jwt-token" });
    expect(await loadStoredToken()).toBe("opaque-non-jwt-token");
  });
});

describe("markSessionInvalidated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTokenCache();
  });

  it("stamps invalidatedAt while preserving the token", async () => {
    const token = fakeJwt({ exp: FUTURE });
    mockAuthFile({ accessToken: token });
    vi.mocked(writePluginFile).mockResolvedValue(undefined);

    await markSessionInvalidated();

    const [file, content] = vi.mocked(writePluginFile).mock.calls[0];
    expect(file).toBe("auth.json");
    const written = JSON.parse(content as string);
    expect(written.accessToken).toBe(token);
    expect(typeof written.invalidatedAt).toBe("string");
  });

  it("saveStoredToken clears previous stamps (fresh login resets)", async () => {
    vi.mocked(writePluginFile).mockResolvedValue(undefined);
    await saveStoredToken("fresh-token");
    const [, content] = vi.mocked(writePluginFile).mock.calls[0];
    const written = JSON.parse(content as string);
    expect(written.accessToken).toBe("fresh-token");
    expect(written.invalidatedAt).toBeUndefined();
    expect(written.nudgedAt).toBeUndefined();
  });
});

describe("shouldNudgeSessionExpired (persisted once-per-expiry-event throttle)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTokenCache();
  });

  it("nudges the first time and stamps nudgedAt", async () => {
    mockAuthFile({ accessToken: fakeJwt({ exp: PAST }) });
    vi.mocked(writePluginFile).mockResolvedValue(undefined);
    expect(await shouldNudgeSessionExpired()).toBe(true);
    const [file, content] = vi.mocked(writePluginFile).mock.calls[0];
    expect(file).toBe("auth.json");
    expect(JSON.parse(content as string).nudgedAt).toBeTruthy();
  });

  it("does not nudge again once nudgedAt is stamped", async () => {
    mockAuthFile({ accessToken: fakeJwt({ exp: PAST }), nudgedAt: "2026-06-10T03:00:00.000Z" });
    expect(await shouldNudgeSessionExpired()).toBe(false);
    expect(vi.mocked(writePluginFile)).not.toHaveBeenCalled();
  });

  it("does not nudge when there is no session at all", async () => {
    mockAuthFile(null);
    expect(await shouldNudgeSessionExpired()).toBe(false);
  });
});
