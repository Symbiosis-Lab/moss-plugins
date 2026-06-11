/**
 * terrarium — moss advisory-window review harness (dev/test).
 *
 * On folder open the preview runs `PluginMode::NonBlocking`, which fires the
 * `process` hook exactly once; edit-rebuilds run `SlotsOnly` (process skipped).
 * So terrarium opens its gallery on open and not on edits, no guard needed.
 *
 * terrarium processes no content — `process` opens the action-panel gallery and
 * returns a passthrough success.
 */

import type { ProcessContext, HookResult } from "@symbiosis-lab/moss-api";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function process(_context: ProcessContext): Promise<HookResult> {
  // Task 5 wires the gallery in. The stub keeps the `process` capability
  // resolving and the IIFE bundling.
  return { success: true };
}
