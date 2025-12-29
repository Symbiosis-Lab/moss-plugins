/**
 * Unit tests for token storage module
 */

import { describe, it, expect } from "vitest";
import {
  formatCredentialInput,
  parseCredentialOutput,
  injectTokenIntoUrl,
  sanitizeUrl,
} from "../token";

describe("token", () => {
  describe("formatCredentialInput", () => {
    it("formats basic protocol and host", () => {
      const result = formatCredentialInput("github.com", "https");
      expect(result).toBe("protocol=https\nhost=github.com\n");
    });

    it("includes username when provided", () => {
      const result = formatCredentialInput("github.com", "https", "x-access-token");
      expect(result).toBe("protocol=https\nhost=github.com\nusername=x-access-token\n");
    });

    it("includes password when provided", () => {
      const result = formatCredentialInput("github.com", "https", "x-access-token", "ghp_abc123");
      expect(result).toBe(
        "protocol=https\nhost=github.com\nusername=x-access-token\npassword=ghp_abc123\n"
      );
    });

    it("handles password without username", () => {
      const result = formatCredentialInput("github.com", "https", undefined, "ghp_abc123");
      expect(result).toBe("protocol=https\nhost=github.com\npassword=ghp_abc123\n");
    });
  });

  describe("parseCredentialOutput", () => {
    it("parses username from output", () => {
      const output = "protocol=https\nhost=github.com\nusername=x-access-token\n";
      const result = parseCredentialOutput(output);
      expect(result.username).toBe("x-access-token");
      expect(result.password).toBeUndefined();
    });

    it("parses password from output", () => {
      const output = "protocol=https\nhost=github.com\npassword=ghp_abc123\n";
      const result = parseCredentialOutput(output);
      expect(result.password).toBe("ghp_abc123");
    });

    it("parses both username and password", () => {
      const output =
        "protocol=https\nhost=github.com\nusername=x-access-token\npassword=ghp_abc123\n";
      const result = parseCredentialOutput(output);
      expect(result.username).toBe("x-access-token");
      expect(result.password).toBe("ghp_abc123");
    });

    it("handles empty output", () => {
      const result = parseCredentialOutput("");
      expect(result.username).toBeUndefined();
      expect(result.password).toBeUndefined();
    });

    it("handles passwords with equals signs", () => {
      const output = "password=ghp_abc=123=def\n";
      const result = parseCredentialOutput(output);
      expect(result.password).toBe("ghp_abc=123=def");
    });

    it("handles extra fields gracefully", () => {
      const output = "protocol=https\nhost=github.com\npath=repo\nusername=user\npassword=pass\n";
      const result = parseCredentialOutput(output);
      expect(result.username).toBe("user");
      expect(result.password).toBe("pass");
    });
  });

  describe("injectTokenIntoUrl", () => {
    it("injects token into HTTPS GitHub URL", () => {
      const url = "https://github.com/user/repo.git";
      const result = injectTokenIntoUrl(url, "ghp_abc123");
      expect(result).toBe("https://x-access-token:ghp_abc123@github.com/user/repo.git");
    });

    it("does not modify SSH URLs", () => {
      const url = "git@github.com:user/repo.git";
      const result = injectTokenIntoUrl(url, "ghp_abc123");
      expect(result).toBe(url);
    });

    it("does not modify non-GitHub URLs", () => {
      const url = "https://gitlab.com/user/repo.git";
      const result = injectTokenIntoUrl(url, "ghp_abc123");
      expect(result).toBe(url);
    });

    it("handles URLs without .git extension", () => {
      const url = "https://github.com/user/repo";
      const result = injectTokenIntoUrl(url, "ghp_abc123");
      expect(result).toBe("https://x-access-token:ghp_abc123@github.com/user/repo");
    });
  });

  describe("sanitizeUrl", () => {
    it("removes token from URL", () => {
      const url = "https://x-access-token:ghp_abc123@github.com/user/repo.git";
      const result = sanitizeUrl(url);
      expect(result).toBe("https://github.com/user/repo.git");
    });

    it("handles URLs without tokens", () => {
      const url = "https://github.com/user/repo.git";
      const result = sanitizeUrl(url);
      expect(result).toBe(url);
    });

    it("handles URLs with different username formats", () => {
      const url = "https://user:pass@github.com/owner/repo.git";
      const result = sanitizeUrl(url);
      expect(result).toBe("https://github.com/owner/repo.git");
    });
  });
});
