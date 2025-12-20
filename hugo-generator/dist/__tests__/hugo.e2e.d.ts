/**
 * E2E tests for Hugo Generator Plugin
 *
 * These tests require Hugo to be installed on the system.
 * They use our test fixtures to verify the complete build pipeline:
 * - Structure translation (moss format → Hugo format)
 * - Hugo build execution
 * - Output verification
 *
 * Note: These tests use Node.js fs directly for file operations since
 * they run in Node.js environment, not Tauri webview. The actual plugin
 * uses moss-api for file operations in production.
 *
 * Run with: npm run test:e2e
 * Tests will be skipped if Hugo is not installed.
 */
export {};
//# sourceMappingURL=hugo.e2e.d.ts.map