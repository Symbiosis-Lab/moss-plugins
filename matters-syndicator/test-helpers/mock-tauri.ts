/**
 * Tauri IPC mocking utilities for testing
 * Uses @tauri-apps/api/mocks for intercepting IPC calls
 */

import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";
import type { InvokeArgs } from "@tauri-apps/api/core";

// In-memory filesystem for testing
export interface MockFile {
  content: string;
  createdAt: Date;
  modifiedAt: Date;
}

export interface MockFilesystem {
  files: Map<string, MockFile>;
  getFile(path: string): MockFile | undefined;
  setFile(path: string, content: string): void;
  deleteFile(path: string): boolean;
  listFiles(pattern?: string): string[];
  clear(): void;
}

export function createMockFilesystem(): MockFilesystem {
  const files = new Map<string, MockFile>();

  return {
    files,
    getFile(path: string) {
      return files.get(path);
    },
    setFile(path: string, content: string) {
      const now = new Date();
      const existing = files.get(path);
      files.set(path, {
        content,
        createdAt: existing?.createdAt ?? now,
        modifiedAt: now,
      });
    },
    deleteFile(path: string) {
      return files.delete(path);
    },
    listFiles(pattern?: string) {
      const allPaths = Array.from(files.keys());
      if (!pattern) return allPaths;
      // Simple glob matching
      const regex = new RegExp(
        "^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$"
      );
      return allPaths.filter((p) => regex.test(p));
    },
    clear() {
      files.clear();
    },
  };
}

// Download tracking for concurrency tests
export interface DownloadTracker {
  activeDownloads: number;
  maxConcurrent: number;
  completedDownloads: string[];
  failedDownloads: Array<{ url: string; error: string }>;
  startDownload(url: string): void;
  endDownload(url: string, success: boolean, error?: string): void;
  reset(): void;
}

export function createDownloadTracker(): DownloadTracker {
  let activeDownloads = 0;
  let maxConcurrent = 0;
  const completedDownloads: string[] = [];
  const failedDownloads: Array<{ url: string; error: string }> = [];

  return {
    get activeDownloads() {
      return activeDownloads;
    },
    get maxConcurrent() {
      return maxConcurrent;
    },
    get completedDownloads() {
      return completedDownloads;
    },
    get failedDownloads() {
      return failedDownloads;
    },
    startDownload(url: string) {
      activeDownloads++;
      if (activeDownloads > maxConcurrent) {
        maxConcurrent = activeDownloads;
      }
    },
    endDownload(url: string, success: boolean, error?: string) {
      activeDownloads--;
      if (success) {
        completedDownloads.push(url);
      } else {
        failedDownloads.push({ url, error: error || "Unknown error" });
      }
    },
    reset() {
      activeDownloads = 0;
      maxConcurrent = 0;
      completedDownloads.length = 0;
      failedDownloads.length = 0;
    },
  };
}

// URL response configuration for mocking
export interface MockUrlResponse {
  status: number;
  ok: boolean;
  contentType?: string;
  bodyBase64?: string;
  bytesWritten?: number;
  actualPath?: string;
  delay?: number; // Artificial delay in ms
  retryCount?: number; // Number of times to fail before succeeding
}

export interface MockUrlConfig {
  responses: Map<string, MockUrlResponse | MockUrlResponse[]>;
  defaultResponse: MockUrlResponse;
  setResponse(url: string, response: MockUrlResponse | MockUrlResponse[]): void;
  getResponse(url: string): MockUrlResponse;
  reset(): void;
}

export function createMockUrlConfig(): MockUrlConfig {
  const responses = new Map<string, MockUrlResponse | MockUrlResponse[]>();
  const callCounts = new Map<string, number>();

  const defaultResponse: MockUrlResponse = {
    status: 200,
    ok: true,
    contentType: "image/png",
    bodyBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", // 1x1 red PNG
    bytesWritten: 68,
    actualPath: "assets/image.png",
  };

  return {
    responses,
    defaultResponse,
    setResponse(url: string, response: MockUrlResponse | MockUrlResponse[]) {
      responses.set(url, response);
      callCounts.set(url, 0);
    },
    getResponse(url: string): MockUrlResponse {
      const config = responses.get(url);
      if (!config) return defaultResponse;

      if (Array.isArray(config)) {
        const count = callCounts.get(url) || 0;
        callCounts.set(url, count + 1);
        // Return the response at the current index, or the last one if we've exceeded
        return config[Math.min(count, config.length - 1)];
      }

      return config;
    },
    reset() {
      responses.clear();
      callCounts.clear();
    },
  };
}

// Main setup function
export interface MockTauriContext {
  filesystem: MockFilesystem;
  downloadTracker: DownloadTracker;
  urlConfig: MockUrlConfig;
  cleanup: () => void;
}

export function setupMockTauri(): MockTauriContext {
  const filesystem = createMockFilesystem();
  const downloadTracker = createDownloadTracker();
  const urlConfig = createMockUrlConfig();

  mockIPC((cmd: string, args?: InvokeArgs) => {
    const payload = args as Record<string, unknown> | undefined;

    switch (cmd) {
      case "read_project_file": {
        const projectPath = payload?.projectPath as string;
        const relativePath = payload?.relativePath as string;
        const fullPath = `${projectPath}/${relativePath}`;
        const file = filesystem.getFile(fullPath);
        if (file) {
          return file.content;
        }
        throw new Error(`File not found: ${fullPath}`);
      }

      case "write_project_file": {
        const projectPath = payload?.projectPath as string;
        const relativePath = payload?.relativePath as string;
        const content = payload?.content as string;
        const fullPath = `${projectPath}/${relativePath}`;
        filesystem.setFile(fullPath, content);
        return null;
      }

      case "fetch_url": {
        const url = payload?.url as string;
        const response = urlConfig.getResponse(url);

        if (response.delay) {
          return new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  status: response.status,
                  ok: response.ok,
                  body_base64: response.bodyBase64 || "",
                  content_type: response.contentType || null,
                }),
              response.delay
            )
          );
        }

        return {
          status: response.status,
          ok: response.ok,
          body_base64: response.bodyBase64 || "",
          content_type: response.contentType || null,
        };
      }

      case "download_asset": {
        const url = payload?.url as string;
        const response = urlConfig.getResponse(url);

        downloadTracker.startDownload(url);

        const result = {
          status: response.status,
          ok: response.ok,
          content_type: response.contentType || null,
          bytes_written: response.bytesWritten || 0,
          actual_path: response.actualPath || "",
        };

        if (response.delay) {
          return new Promise((resolve) =>
            setTimeout(() => {
              downloadTracker.endDownload(url, response.ok);
              resolve(result);
            }, response.delay)
          );
        }

        downloadTracker.endDownload(url, response.ok);
        return result;
      }

      case "get_plugin_cookie": {
        // Return empty cookies by default
        return [];
      }

      default:
        console.warn(`Unhandled IPC command: ${cmd}`);
        return null;
    }
  });

  return {
    filesystem,
    downloadTracker,
    urlConfig,
    cleanup: () => {
      clearMocks();
      filesystem.clear();
      downloadTracker.reset();
      urlConfig.reset();
    },
  };
}

export { clearMocks };
