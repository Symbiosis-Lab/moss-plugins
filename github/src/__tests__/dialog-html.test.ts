/**
 * Unit tests for the Repository Creation Dialog HTML
 *
 * Tests the embedded HTML dialog behavior in a DOM environment using happy-dom.
 * Verifies form validation, visual states, and IPC calls.
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRepoDialogHtml } from "../repo-dialog";

describe("Repository Creation Dialog HTML", () => {
  const testUsername = "testuser";
  const testToken = "gho_testtoken";
  let container: HTMLDivElement;

  beforeEach(() => {
    // Create a fresh container for each test
    container = document.createElement("div");
    document.body.appendChild(container);

    // Mock window.__TAURI__ for Tauri IPC calls
    (globalThis as Record<string, unknown>).__TAURI__ = {
      core: {
        invoke: vi.fn().mockResolvedValue(undefined),
      },
    };

    // Load the dialog HTML into the container
    const html = createRepoDialogHtml(testUsername, testToken);
    container.innerHTML = html;
  });

  describe("Form Structure", () => {
    it("renders title correctly", () => {
      const title = container.querySelector("h1");
      expect(title?.textContent).toBe("Create GitHub Repository");
    });

    it("renders username prefix in input wrapper", () => {
      const prefix = container.querySelector(".prefix");
      expect(prefix?.textContent).toContain(`github.com/${testUsername}/`);
    });

    it("renders repo name input", () => {
      const input = container.querySelector("#repo-name") as HTMLInputElement;
      expect(input).toBeDefined();
      expect(input.placeholder).toBe("my-website");
    });

    it("renders create button as disabled initially", () => {
      const button = container.querySelector("#create-btn") as HTMLButtonElement;
      expect(button).toBeDefined();
      expect(button.disabled).toBe(true);
      expect(button.textContent).toBe("Create Repository");
    });

    it("renders cancel button", () => {
      const button = container.querySelector("#cancel-btn") as HTMLButtonElement;
      expect(button).toBeDefined();
      expect(button.textContent).toBe("Cancel");
    });

    it("renders note about public repositories", () => {
      const note = container.querySelector(".note");
      expect(note?.textContent).toContain("public");
      expect(note?.textContent).toContain("GitHub Pages");
    });
  });

  describe("Input Validation", () => {
    it("shows empty status when input is empty", () => {
      const status = container.querySelector("#status");
      expect(status?.textContent).toBe("");
    });
  });

  describe("Styling", () => {
    it("includes dark theme styles", () => {
      const styles = container.querySelector("style");
      expect(styles?.textContent).toContain("--bg: #1a1a1a");
      expect(styles?.textContent).toContain("--primary: #58a6ff");
    });

    it("includes form validation styles", () => {
      const styles = container.querySelector("style");
      expect(styles?.textContent).toContain(".status.checking");
      expect(styles?.textContent).toContain(".status.available");
      expect(styles?.textContent).toContain(".status.taken");
      expect(styles?.textContent).toContain(".status.invalid");
    });

    it("includes spinner animation", () => {
      const styles = container.querySelector("style");
      expect(styles?.textContent).toContain("@keyframes spin");
      expect(styles?.textContent).toContain(".spinner");
    });
  });

  describe("Script Configuration", () => {
    it("includes token in script for API calls", () => {
      const scripts = container.querySelectorAll("script");
      const script = scripts[scripts.length - 1];
      expect(script?.textContent).toContain(`const token = '${testToken}'`);
    });

    it("includes validation regex", () => {
      const scripts = container.querySelectorAll("script");
      const script = scripts[scripts.length - 1];
      expect(script?.textContent).toContain("validNameRegex");
      expect(script?.textContent).toContain("/^[a-zA-Z0-9._-]+$/");
    });

    it("includes checkAvailability function", () => {
      const scripts = container.querySelectorAll("script");
      const script = scripts[scripts.length - 1];
      expect(script?.textContent).toContain("async function checkAvailability");
    });

    it("includes validateName function", () => {
      const scripts = container.querySelectorAll("script");
      const script = scripts[scripts.length - 1];
      expect(script?.textContent).toContain("function validateName");
    });

    it("includes setStatus function", () => {
      const scripts = container.querySelectorAll("script");
      const script = scripts[scripts.length - 1];
      expect(script?.textContent).toContain("function setStatus");
    });
  });

  describe("Validation Logic", () => {
    it("script checks for names starting with period", () => {
      const scripts = container.querySelectorAll("script");
      const script = scripts[scripts.length - 1];
      expect(script?.textContent).toContain("startsWith('.')");
      expect(script?.textContent).toContain("cannot start with a period");
    });

    it("script checks for name length limit", () => {
      const scripts = container.querySelectorAll("script");
      const script = scripts[scripts.length - 1];
      expect(script?.textContent).toContain("length > 100");
      expect(script?.textContent).toContain("too long");
    });

    it("script checks for invalid characters", () => {
      const scripts = container.querySelectorAll("script");
      const script = scripts[scripts.length - 1];
      expect(script?.textContent).toContain("validNameRegex.test");
    });
  });

  describe("IPC Communication", () => {
    it("includes submit_dialog_result call for cancel", () => {
      const scripts = container.querySelectorAll("script");
      const script = scripts[scripts.length - 1];
      expect(script?.textContent).toContain("invoke('submit_dialog_result'");
      expect(script?.textContent).toContain("type: 'cancelled'");
    });

    it("includes submit_dialog_result call for submit", () => {
      const scripts = container.querySelectorAll("script");
      const script = scripts[scripts.length - 1];
      expect(script?.textContent).toContain("type: 'submitted'");
      expect(script?.textContent).toContain("value: { name: name }");
    });

    it("references dialogId from URL params", () => {
      const scripts = container.querySelectorAll("script");
      const script = scripts[scripts.length - 1];
      expect(script?.textContent).toContain("URLSearchParams");
      expect(script?.textContent).toContain("dialogId");
    });
  });

  describe("Debouncing", () => {
    it("includes debounce timeout for API check", () => {
      const scripts = container.querySelectorAll("script");
      const script = scripts[scripts.length - 1];
      expect(script?.textContent).toContain("checkTimeout");
      expect(script?.textContent).toContain("setTimeout");
      expect(script?.textContent).toContain("300"); // 300ms debounce
    });

    it("clears previous timeout on new input", () => {
      const scripts = container.querySelectorAll("script");
      const script = scripts[scripts.length - 1];
      expect(script?.textContent).toContain("clearTimeout");
    });
  });

  describe("API Integration", () => {
    it("includes GitHub API check URL with username", () => {
      const scripts = container.querySelectorAll("script");
      const script = scripts[scripts.length - 1];
      expect(script?.textContent).toContain(`https://api.github.com/repos/${testUsername}/`);
    });

    it("includes authorization header with token", () => {
      const scripts = container.querySelectorAll("script");
      const script = scripts[scripts.length - 1];
      expect(script?.textContent).toContain("'Authorization': 'Bearer ' + token");
    });

    it("handles 404 response as available", () => {
      const scripts = container.querySelectorAll("script");
      const script = scripts[scripts.length - 1];
      expect(script?.textContent).toContain("status === 404");
      expect(script?.textContent).toContain("'available'");
    });

    it("handles 200 response as taken", () => {
      const scripts = container.querySelectorAll("script");
      const script = scripts[scripts.length - 1];
      expect(script?.textContent).toContain("response.ok");
      expect(script?.textContent).toContain("'taken'");
    });
  });

  describe("Accessibility", () => {
    it("has autofocus on repo name input", () => {
      const input = container.querySelector("#repo-name");
      expect(input?.hasAttribute("autofocus")).toBe(true);
    });

    it("has autocomplete off on input", () => {
      const input = container.querySelector("#repo-name") as HTMLInputElement;
      expect(input.autocomplete).toBe("off");
    });

    it("has label for input", () => {
      const label = container.querySelector("label[for='repo-name']");
      expect(label).toBeDefined();
      expect(label?.textContent).toBe("Repository name");
    });
  });
});
