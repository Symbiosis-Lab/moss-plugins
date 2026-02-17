/**
 * Git Blob Hash Tests
 *
 * Verifies that gitBlobHash produces identical output to `git hash-object`.
 * Known test vectors are pre-computed with git to ensure compatibility.
 */

import { describe, test, expect } from "vitest";
import { gitBlobHash, gitBlobHashFromBytes } from "../hash";

/**
 * Known test vectors computed with:
 *   echo -n "<content>" | git hash-object --stdin
 */
describe("gitBlobHash", () => {
  test("empty string", async () => {
    // echo -n "" | git hash-object --stdin
    // e69de29bb2d1d6434b8b29ae775ad8c2e48c5391
    const base64 = btoa("");
    const hash = await gitBlobHash(base64);
    expect(hash).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
  });

  test("hello world", async () => {
    // echo -n "hello world" | git hash-object --stdin
    // 95d09f2b10159347eece71399a7e2e907ea3df4f
    const base64 = btoa("hello world");
    const hash = await gitBlobHash(base64);
    expect(hash).toBe("95d09f2b10159347eece71399a7e2e907ea3df4f");
  });

  test("hello world with newline", async () => {
    // echo "hello world" | git hash-object --stdin  (echo adds \n)
    // 3b18e512dba79e4c8300dd08aeb37f8e728b8dad
    const base64 = btoa("hello world\n");
    const hash = await gitBlobHash(base64);
    expect(hash).toBe("3b18e512dba79e4c8300dd08aeb37f8e728b8dad");
  });

  test("HTML content", async () => {
    // echo -n "<html><body>Hello</body></html>" | git hash-object --stdin
    // f0ea4e2458e37ec873d0dd991cc06ec830921591
    const content = "<html><body>Hello</body></html>";
    const base64 = btoa(content);
    const hash = await gitBlobHash(base64);
    expect(hash).toBe("f0ea4e2458e37ec873d0dd991cc06ec830921591");
  });
});

describe("gitBlobHashFromBytes", () => {
  test("empty bytes", async () => {
    const hash = await gitBlobHashFromBytes(new Uint8Array(0));
    expect(hash).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
  });

  test("binary content (null bytes)", async () => {
    // printf '\x00\x01\x02' | git hash-object --stdin
    // 8352675d67aed6625ece79af41c27fdb4ee2e867
    const bytes = new Uint8Array([0x00, 0x01, 0x02]);
    const hash = await gitBlobHashFromBytes(bytes);
    expect(hash).toBe("8352675d67aed6625ece79af41c27fdb4ee2e867");
  });

  test("matches gitBlobHash for text content", async () => {
    const text = "test content";
    const base64 = btoa(text);
    const hashFromBase64 = await gitBlobHash(base64);
    const hashFromBytes = await gitBlobHashFromBytes(
      new TextEncoder().encode(text)
    );
    expect(hashFromBase64).toBe(hashFromBytes);
  });
});
