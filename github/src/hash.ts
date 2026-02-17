/**
 * Git Blob SHA-1 Hashing
 *
 * Computes git-compatible blob hashes using the Web Crypto API.
 * Produces identical output to `git hash-object <file>`.
 *
 * Algorithm: SHA-1("blob {byte_length}\0{content}")
 * Reference: https://git-scm.com/book/en/v2/Git-Internals-Git-Objects
 *
 * Correctness is verified two ways:
 * 1. Unit tests compare output against known git hash-object results
 * 2. At runtime, every GitHub blob upload returns the SHA — mismatches are detected
 */

/**
 * Compute git blob hash from base64-encoded content.
 *
 * @param base64Content - Base64-encoded file content (from readSiteFile/readProjectFileBase64)
 * @returns Hex-encoded SHA-1 hash identical to `git hash-object`
 */
export async function gitBlobHash(base64Content: string): Promise<string> {
  // Decode base64 to binary
  const binaryString = atob(base64Content);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return gitBlobHashFromBytes(bytes);
}

/**
 * Compute git blob hash from raw bytes.
 *
 * @param content - Raw file content as Uint8Array
 * @returns Hex-encoded SHA-1 hash identical to `git hash-object`
 */
export async function gitBlobHashFromBytes(
  content: Uint8Array
): Promise<string> {
  // Git blob format: "blob {size}\0{content}"
  const header = new TextEncoder().encode(`blob ${content.length}\0`);
  const full = new Uint8Array(header.length + content.length);
  full.set(header);
  full.set(content, header.length);

  const digest = await crypto.subtle.digest("SHA-1", full);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
