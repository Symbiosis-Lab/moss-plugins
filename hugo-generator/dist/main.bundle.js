"use strict";
var HugoGenerator = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // dist/main.js
  var main_exports = {};
  __export(main_exports, {
    default: () => main_default,
    on_build: () => on_build
  });

  // node_modules/@symbiosis-lab/moss-api/dist/index.mjs
  function getTauriCore() {
    const w = window;
    if (!w.__TAURI__?.core) throw new Error("Tauri core not available");
    return w.__TAURI__.core;
  }
  function isTauriAvailable() {
    return !!window.__TAURI__?.core;
  }
  var currentPluginName = "";
  var currentHookName = "";
  async function sendMessage(message) {
    if (!isTauriAvailable()) return;
    try {
      await getTauriCore().invoke("plugin_message", {
        pluginName: currentPluginName,
        hookName: currentHookName,
        message
      });
    } catch {
    }
  }
  async function reportProgress(phase, current, total, message) {
    await sendMessage({
      type: "progress",
      phase,
      current,
      total,
      message
    });
  }
  async function executeBinary(options) {
    const { binaryPath, args, workingDir, timeoutMs = 6e4, env } = options;
    const result = await getTauriCore().invoke("execute_binary", {
      binaryPath,
      args,
      workingDir,
      timeoutMs,
      env
    });
    return {
      success: result.success,
      exitCode: result.exit_code,
      stdout: result.stdout,
      stderr: result.stderr
    };
  }

  // dist/main.js
  async function on_build(context) {
    const hugoPath = context.config.hugo_path || "hugo";
    const buildArgs = context.config.build_args || ["--minify"];
    reportProgress("building", 0, 1, "Running Hugo...");
    try {
      const result = await executeBinary({
        binaryPath: hugoPath,
        args: [
          "--source",
          context.project_path,
          "--destination",
          context.output_dir,
          "--quiet",
          ...buildArgs
        ],
        workingDir: context.project_path,
        timeoutMs: 3e5
        // 5 minutes for large sites
      });
      if (!result.success) {
        const errorMessage = result.stderr || `Hugo exited with code ${result.exitCode}`;
        return {
          success: false,
          message: `Hugo build failed: ${errorMessage}`
        };
      }
      reportProgress("complete", 1, 1, "Hugo build complete");
      return { success: true, message: "Hugo build complete" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to execute Hugo: ${errorMessage}`
      };
    }
  }
  var HugoGenerator = { on_build };
  window.HugoGenerator = HugoGenerator;
  var main_default = HugoGenerator;
  return __toCommonJS(main_exports);
})();
