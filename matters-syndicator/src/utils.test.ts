import { describe, it, expect } from "vitest";
import {
  slugify,
  simpleHash,
  generateLocalFilename,
  getExtensionFromContentType,
  uint8ArrayToBase64,
} from "./utils";

describe("slugify", () => {
  it("converts simple text to lowercase slug", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("removes special characters", () => {
    expect(slugify("Hello! World?")).toBe("hello-world");
  });

  it("handles multiple spaces", () => {
    expect(slugify("Hello   World")).toBe("hello-world");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("  Hello World  ")).toBe("hello-world");
  });

  it("preserves CJK characters", () => {
    expect(slugify("你好世界")).toBe("你好世界");
    expect(slugify("Hello 世界")).toBe("hello-世界");
  });

  it("preserves Cyrillic characters", () => {
    expect(slugify("Привет мир")).toBe("привет-мир");
  });

  it("preserves Arabic characters", () => {
    expect(slugify("مرحبا بالعالم")).toBe("مرحبا-بالعالم");
  });

  it("handles empty string", () => {
    expect(slugify("")).toBe("");
  });

  it("handles numbers", () => {
    expect(slugify("Test 123")).toBe("test-123");
  });

  it("collapses multiple hyphens", () => {
    expect(slugify("Hello---World")).toBe("hello-world");
  });
});

describe("simpleHash", () => {
  it("returns consistent hash for same input", () => {
    const hash1 = simpleHash("test");
    const hash2 = simpleHash("test");
    expect(hash1).toBe(hash2);
  });

  it("returns different hash for different inputs", () => {
    const hash1 = simpleHash("test1");
    const hash2 = simpleHash("test2");
    expect(hash1).not.toBe(hash2);
  });

  it("returns hexadecimal string", () => {
    const hash = simpleHash("test");
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it("handles empty string", () => {
    const hash = simpleHash("");
    expect(hash).toBe("0");
  });
});

describe("generateLocalFilename", () => {
  it("extracts filename with extension from URL", () => {
    expect(
      generateLocalFilename("https://example.com/images/photo.jpg")
    ).toBe("photo.jpg");
  });

  it("extracts UUID-based filename", () => {
    expect(
      generateLocalFilename(
        "https://cdn.example.com/550e8400-e29b-41d4-a716-446655440000/image.png"
      )
    ).toBe("550e8400-e29b-41d4-a716-446655440000.png");
  });

  it("handles UUID without extension", () => {
    expect(
      generateLocalFilename(
        "https://cdn.example.com/550e8400-e29b-41d4-a716-446655440000"
      )
    ).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("removes /public suffix", () => {
    expect(
      generateLocalFilename("https://cdn.example.com/image.jpg/public")
    ).toBe("image.jpg");
  });

  it("falls back to hash for URLs without filename", () => {
    const result = generateLocalFilename("https://example.com/");
    expect(result).toMatch(/^[0-9a-f]+$/);
  });

  it("returns null for invalid URLs", () => {
    expect(generateLocalFilename("not-a-url")).toBeNull();
  });
});

describe("getExtensionFromContentType", () => {
  it("returns jpg for image/jpeg", () => {
    expect(getExtensionFromContentType("image/jpeg")).toBe("jpg");
  });

  it("returns jpg for image/jpg", () => {
    expect(getExtensionFromContentType("image/jpg")).toBe("jpg");
  });

  it("returns png for image/png", () => {
    expect(getExtensionFromContentType("image/png")).toBe("png");
  });

  it("returns gif for image/gif", () => {
    expect(getExtensionFromContentType("image/gif")).toBe("gif");
  });

  it("returns webp for image/webp", () => {
    expect(getExtensionFromContentType("image/webp")).toBe("webp");
  });

  it("returns svg for image/svg+xml", () => {
    expect(getExtensionFromContentType("image/svg+xml")).toBe("svg");
  });

  it("handles content-type with charset", () => {
    expect(getExtensionFromContentType("image/png; charset=utf-8")).toBe("png");
  });

  it("returns null for unknown content types", () => {
    expect(getExtensionFromContentType("application/json")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(getExtensionFromContentType("")).toBeNull();
  });
});

describe("uint8ArrayToBase64", () => {
  it("converts small arrays correctly", () => {
    const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    expect(uint8ArrayToBase64(bytes)).toBe("SGVsbG8=");
  });

  it("handles empty array", () => {
    const bytes = new Uint8Array([]);
    expect(uint8ArrayToBase64(bytes)).toBe("");
  });

  it("handles large arrays without stack overflow", () => {
    // Create a 100KB array
    const bytes = new Uint8Array(100000);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = i % 256;
    }
    // Should not throw
    const result = uint8ArrayToBase64(bytes);
    expect(result.length).toBeGreaterThan(0);
  });
});
