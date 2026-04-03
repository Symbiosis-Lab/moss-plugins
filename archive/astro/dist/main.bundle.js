"use strict";
var AstroPlugin = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __esm = (fn, res) => function __init() {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  };
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

  // ../../packages/moss-api/dist/core-serM6jqp.mjs
  var core_serM6jqp_exports = {};
  __export(core_serM6jqp_exports, {
    invoke: () => invoke,
    transformCallback: () => transformCallback
  });
  function __classPrivateFieldGet(receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
  }
  function __classPrivateFieldSet(receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
  }
  function transformCallback(callback, once = false) {
    return window.__TAURI_INTERNALS__.transformCallback(callback, once);
  }
  async function invoke(cmd, args = {}, options) {
    return window.__TAURI_INTERNALS__.invoke(cmd, args, options);
  }
  var _Channel_onmessage, _Channel_nextMessageIndex, _Channel_pendingMessages, _Channel_messageEndIndex, _Resource_rid, SERIALIZE_TO_IPC_FN, Channel;
  var init_core_serM6jqp = __esm({
    "../../packages/moss-api/dist/core-serM6jqp.mjs"() {
      "use strict";
      SERIALIZE_TO_IPC_FN = "__TAURI_TO_IPC_KEY__";
      Channel = class {
        constructor(onmessage) {
          _Channel_onmessage.set(this, void 0);
          _Channel_nextMessageIndex.set(this, 0);
          _Channel_pendingMessages.set(this, []);
          _Channel_messageEndIndex.set(this, void 0);
          __classPrivateFieldSet(this, _Channel_onmessage, onmessage || (() => {
          }), "f");
          this.id = transformCallback((rawMessage) => {
            const index = rawMessage.index;
            if ("end" in rawMessage) {
              if (index == __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")) this.cleanupCallback();
              else __classPrivateFieldSet(this, _Channel_messageEndIndex, index, "f");
              return;
            }
            const message = rawMessage.message;
            if (index == __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")) {
              __classPrivateFieldGet(this, _Channel_onmessage, "f").call(this, message);
              __classPrivateFieldSet(this, _Channel_nextMessageIndex, __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") + 1, "f");
              while (__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") in __classPrivateFieldGet(this, _Channel_pendingMessages, "f")) {
                const message$1 = __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")];
                __classPrivateFieldGet(this, _Channel_onmessage, "f").call(this, message$1);
                delete __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")];
                __classPrivateFieldSet(this, _Channel_nextMessageIndex, __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") + 1, "f");
              }
              if (__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") === __classPrivateFieldGet(this, _Channel_messageEndIndex, "f")) this.cleanupCallback();
            } else __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[index] = message;
          });
        }
        cleanupCallback() {
          window.__TAURI_INTERNALS__.unregisterCallback(this.id);
        }
        set onmessage(handler) {
          __classPrivateFieldSet(this, _Channel_onmessage, handler, "f");
        }
        get onmessage() {
          return __classPrivateFieldGet(this, _Channel_onmessage, "f");
        }
        [(_Channel_onmessage = /* @__PURE__ */ new WeakMap(), _Channel_nextMessageIndex = /* @__PURE__ */ new WeakMap(), _Channel_pendingMessages = /* @__PURE__ */ new WeakMap(), _Channel_messageEndIndex = /* @__PURE__ */ new WeakMap(), SERIALIZE_TO_IPC_FN)]() {
          return `__CHANNEL__:${this.id}`;
        }
        toJSON() {
          return this[SERIALIZE_TO_IPC_FN]();
        }
      };
      _Resource_rid = /* @__PURE__ */ new WeakMap();
    }
  });

  // ../../packages/moss-api/dist/event-BovtnpSn.mjs
  var event_BovtnpSn_exports = {};
  __export(event_BovtnpSn_exports, {
    listen: () => listen
  });
  async function _unlisten(event, eventId) {
    window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener(event, eventId);
    await invoke("plugin:event|unlisten", {
      event,
      eventId
    });
  }
  async function listen(event, handler, options) {
    var _a;
    return invoke("plugin:event|listen", {
      event,
      target: typeof (options === null || options === void 0 ? void 0 : options.target) === "string" ? {
        kind: "AnyLabel",
        label: options.target
      } : (_a = options === null || options === void 0 ? void 0 : options.target) !== null && _a !== void 0 ? _a : { kind: "Any" },
      handler: transformCallback(handler)
    }).then((eventId) => {
      return async () => _unlisten(event, eventId);
    });
  }
  var TauriEvent;
  var init_event_BovtnpSn = __esm({
    "../../packages/moss-api/dist/event-BovtnpSn.mjs"() {
      "use strict";
      init_core_serM6jqp();
      (function(TauriEvent$1) {
        TauriEvent$1["WINDOW_RESIZED"] = "tauri://resize";
        TauriEvent$1["WINDOW_MOVED"] = "tauri://move";
        TauriEvent$1["WINDOW_CLOSE_REQUESTED"] = "tauri://close-requested";
        TauriEvent$1["WINDOW_DESTROYED"] = "tauri://destroyed";
        TauriEvent$1["WINDOW_FOCUS"] = "tauri://focus";
        TauriEvent$1["WINDOW_BLUR"] = "tauri://blur";
        TauriEvent$1["WINDOW_SCALE_FACTOR_CHANGED"] = "tauri://scale-change";
        TauriEvent$1["WINDOW_THEME_CHANGED"] = "tauri://theme-changed";
        TauriEvent$1["WINDOW_CREATED"] = "tauri://window-created";
        TauriEvent$1["WEBVIEW_CREATED"] = "tauri://webview-created";
        TauriEvent$1["DRAG_ENTER"] = "tauri://drag-enter";
        TauriEvent$1["DRAG_OVER"] = "tauri://drag-over";
        TauriEvent$1["DRAG_DROP"] = "tauri://drag-drop";
        TauriEvent$1["DRAG_LEAVE"] = "tauri://drag-leave";
      })(TauriEvent || (TauriEvent = {}));
    }
  });

  // src/main.ts
  var main_exports = {};
  __export(main_exports, {
    default: () => main_default,
    on_build: () => on_build
  });

  // ../../packages/moss-api/dist/index.mjs
  function getTauriCore() {
    const w = window;
    if (!w.__TAURI__?.core) throw new Error("Tauri core not available");
    return w.__TAURI__.core;
  }
  function isTauriAvailable() {
    return !!window.__TAURI__?.core;
  }
  function getTauriEvent$1() {
    const w = window;
    if (!w.__TAURI__?.event) throw new Error("Tauri event API not available");
    return w.__TAURI__.event;
  }
  function isEventApiAvailable() {
    return !!window.__TAURI__?.event;
  }
  async function emitEvent(event, payload) {
    await getTauriEvent$1().emit(event, payload);
  }
  async function onEvent(event, handler) {
    return await getTauriEvent$1().listen(event, (e) => {
      handler(e.payload);
    });
  }
  var currentPluginName = "";
  var currentHookName = "";
  async function sendMessage(message) {
    if (message.type === "log" || message.type === "progress") {
      if (!isEventApiAvailable()) return;
      try {
        await emitEvent("plugin-message", {
          pluginName: currentPluginName,
          hookName: currentHookName,
          message
        });
      } catch {
      }
      return;
    }
    if (!isTauriAvailable()) return;
    try {
      await getTauriCore().invoke("plugin_message", {
        pluginName: currentPluginName,
        hookName: currentHookName,
        message
      });
    } catch (error) {
      console.error("\u274C [SDK] Failed to send message:", message.type, "\u2013", error);
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
  function getInternalContext() {
    const context = window.__MOSS_INTERNAL_CONTEXT__;
    if (!context) throw new Error("This function must be called from within a plugin hook. Ensure you're calling this from process(), generate(), deploy(), or syndicate().");
    return context;
  }
  async function readFile(relativePath) {
    const ctx = getInternalContext();
    return getTauriCore().invoke("read_project_file", {
      projectPath: ctx.project_path,
      relativePath
    });
  }
  async function writeFile(relativePath, content) {
    const ctx = getInternalContext();
    await getTauriCore().invoke("write_project_file", {
      projectPath: ctx.project_path,
      relativePath,
      data: content
    });
  }
  async function listFiles() {
    const ctx = getInternalContext();
    return getTauriCore().invoke("list_project_files", { projectPath: ctx.project_path });
  }
  async function fileExists(relativePath) {
    getInternalContext();
    try {
      await readFile(relativePath);
      return true;
    } catch {
      return false;
    }
  }
  async function createSymlink(targetPath, linkPath) {
    const ctx = getInternalContext();
    await getTauriCore().invoke("create_project_symlink", {
      projectPath: ctx.project_path,
      targetPath,
      linkPath
    });
  }
  async function executeBinary(options) {
    const ctx = getInternalContext();
    const { binaryPath, args, timeoutMs = 6e4, env, stdin, workingDir, onStderr } = options;
    const resolvedWorkingDir = workingDir ? `${ctx.project_path}/${workingDir}` : ctx.project_path;
    const streamId = onStderr ? crypto.randomUUID() : void 0;
    let unlisten;
    if (onStderr && streamId) unlisten = await onEvent("binary-output", (payload) => {
      if (payload.streamId === streamId) onStderr(payload.line);
    });
    try {
      const result = await getTauriCore().invoke("execute_binary", {
        binaryPath,
        args,
        workingDir: resolvedWorkingDir,
        timeoutMs,
        env,
        stdinData: stdin,
        streamId
      });
      return {
        success: result.success,
        exitCode: result.exit_code,
        stdout: result.stdout,
        stderr: result.stderr
      };
    } finally {
      if (unlisten) unlisten();
    }
  }
  var BinaryResolutionError = class extends Error {
    constructor(message, phase, cause) {
      super(message);
      this.phase = phase;
      this.cause = cause;
      this.name = "BinaryResolutionError";
    }
  };
  async function resolveBinary(config, options = {}) {
    const { configuredPath, autoDownload = true, onProgress } = options;
    let unlisten;
    if (onProgress) {
      const { listen: listen2 } = await Promise.resolve().then(() => (init_event_BovtnpSn(), event_BovtnpSn_exports));
      unlisten = await listen2("download-progress", (event) => {
        if (event.payload.binary === config.name) {
          const { bytes_downloaded, total_bytes } = event.payload;
          onProgress(config.name, bytes_downloaded, total_bytes ?? void 0);
        }
      });
    }
    try {
      const { invoke: invoke2 } = await Promise.resolve().then(() => (init_core_serM6jqp(), core_serM6jqp_exports));
      return await invoke2("resolve_binary_command", {
        config,
        configuredPath: configuredPath ?? null,
        autoDownload
      });
    } catch (error) {
      throw new BinaryResolutionError(error instanceof Error ? error.message : String(error), "detection");
    } finally {
      unlisten?.();
    }
  }

  // src/structure.ts
  function wrapInAstroPage(content, title) {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    let bodyContent = content;
    let extractedTitle = title || "Page";
    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];
      const titleMatch = frontmatter.match(/title:\s*["']?([^"'\n]+)["']?/);
      if (titleMatch) {
        extractedTitle = titleMatch[1];
      }
      bodyContent = content.substring(frontmatterMatch[0].length).trim();
    }
    return `---
import Layout from '../layouts/Layout.astro';
---

<Layout title="${extractedTitle}">
  <article>
${bodyContent.split("\n").map((line) => "    " + line).join("\n")}
  </article>
</Layout>
`;
  }
  async function createAstroStructure(projectPath, projectInfo, runtimeDir, _mossDir) {
    const runtimeRelative = getRelativePath(projectPath, runtimeDir);
    if (projectInfo.homepage_file) {
      const homepageExists = await fileExists(projectInfo.homepage_file);
      if (homepageExists) {
        const content = await readFile(projectInfo.homepage_file);
        const astroContent = wrapInAstroPage(content, "Home");
        await writeFile(`${runtimeRelative}/src/pages/index.astro`, astroContent);
      }
    }
    const allFiles = await listFiles();
    const markdownFiles = allFiles.filter((f) => f.endsWith(".md"));
    for (const folder of projectInfo.content_folders) {
      const folderFiles = markdownFiles.filter(
        (f) => f.startsWith(`${folder}/`)
      );
      for (const file of folderFiles) {
        const relativePath = file.substring(folder.length + 1);
        await createSymlink(file, `${runtimeRelative}/src/content/${folder}/${relativePath}`);
      }
    }
    const rootMarkdownFiles = markdownFiles.filter(
      (f) => !f.includes("/") && f !== projectInfo.homepage_file
    );
    for (const file of rootMarkdownFiles) {
      const content = await readFile(file);
      const baseName = file.replace(/\.md$/, "");
      const astroContent = wrapInAstroPage(content, baseName);
      await writeFile(`${runtimeRelative}/src/pages/${baseName}.astro`, astroContent);
    }
    const assetFiles = allFiles.filter((f) => f.startsWith("assets/"));
    for (const file of assetFiles) {
      await createSymlink(file, `${runtimeRelative}/public/${file}`);
    }
  }
  async function createAstroConfig(siteConfig, runtimeDir, projectPath) {
    const siteName = siteConfig.site_name || "Site";
    const baseUrl = siteConfig.base_url || "/";
    const runtimeRelative = getRelativePath(projectPath, runtimeDir);
    const config = `// Auto-generated Astro configuration
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: '${baseUrl === "/" ? "" : baseUrl}',
  output: 'static',
  build: {
    format: 'directory',
  },
  markdown: {
    shikiConfig: {
      theme: 'github-light',
    },
  },
});

// Site name: ${siteName}
`;
    await writeFile(`${runtimeRelative}/astro.config.mjs`, config);
  }
  async function cleanupRuntime(_runtimeDir) {
  }
  function getRelativePath(basePath, targetPath) {
    if (targetPath.startsWith(basePath)) {
      return targetPath.substring(basePath.length).replace(/^\//, "");
    }
    if (!targetPath.startsWith("/")) {
      return targetPath;
    }
    return targetPath;
  }
  async function translatePageTree(node, contentDir) {
    if (node.draft) return;
    if (node.is_folder) {
      const fm = { title: `"${node.title}"` };
      if (node.nav_weight !== void 0) {
        fm.weight = node.nav_weight;
      }
      const yamlLines = Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join("\n");
      const content = `---
${yamlLines}
---
`;
      const indexPath = node.source_path === "" ? `${contentDir}/index.md` : `${contentDir}/${node.source_path}/index.md`;
      await writeFile(indexPath, content);
      for (const child of node.children) {
        await translatePageTree(child, contentDir);
      }
    } else {
      await createSymlink(node.source_path, `${contentDir}/${node.source_path}`);
    }
  }

  // src/templates.ts
  async function createDefaultLayouts(runtimeDir, projectPath) {
    const runtimeRelative = getRelativePath2(projectPath, runtimeDir);
    await writeFile(
      `${runtimeRelative}/src/layouts/Layout.astro`,
      `---
interface Props {
  title: string;
}

const { title } = Astro.props;
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{title}</title>
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        line-height: 1.6;
        max-width: 800px;
        margin: 0 auto;
        padding: 2rem;
        color: #333;
      }
      a { color: #0066cc; }
      h1, h2, h3 { margin-top: 2rem; }
      code {
        background: #f4f4f4;
        padding: 0.2rem 0.4rem;
        border-radius: 3px;
      }
      pre code {
        display: block;
        padding: 1rem;
        overflow-x: auto;
      }
    </style>
  </head>
  <body>
    <header>
      <nav>
        <a href="/">Home</a>
      </nav>
    </header>
    <main>
      <slot />
    </main>
    <footer>
      <p>&copy; {new Date().getFullYear()}</p>
    </footer>
  </body>
</html>
`
    );
    await writeFile(
      `${runtimeRelative}/package.json`,
      `{
  "name": "astro-site",
  "type": "module",
  "version": "0.0.1",
  "scripts": {
    "build": "astro build"
  },
  "dependencies": {
    "astro": "^4.0.0"
  }
}
`
    );
  }
  function getRelativePath2(basePath, targetPath) {
    if (targetPath.startsWith(basePath)) {
      return targetPath.substring(basePath.length).replace(/^\//, "");
    }
    if (!targetPath.startsWith("/")) {
      return targetPath;
    }
    return targetPath;
  }

  // src/astro-config.ts
  var ASTRO_BINARY_CONFIG = {
    name: "npx",
    binary_name: "npx",
    version_check: {
      args: ["--version"],
      pattern: "(\\d+\\.\\d+\\.\\d+)"
    },
    sources: {}
  };

  // src/main.ts
  async function on_build(context) {
    const buildArgs = context.config.build_args || [];
    const runtimeDir = `${context.moss_dir}/plugins/astro-generator/.runtime`;
    try {
      reportProgress("setup", 0, 4, "Resolving npx binary...");
      let npxPath;
      try {
        const npxResolution = await resolveBinary(ASTRO_BINARY_CONFIG, {
          autoDownload: false,
          onProgress: (binary, bytesDownloaded, totalBytes) => {
            const total = totalBytes ? `/${totalBytes}` : "";
            reportProgress("setup", 0, 4, `Downloading ${binary}: ${bytesDownloaded}${total} bytes`);
          }
        });
        npxPath = npxResolution.path;
        if (npxResolution.version) {
          reportProgress(
            "setup",
            0,
            4,
            `Using npx ${npxResolution.version}`
          );
        }
      } catch (error) {
        if (error instanceof BinaryResolutionError) {
          return {
            success: false,
            message: `Astro setup failed: ${error.message}. Install Node.js from nodejs.org`
          };
        }
        throw error;
      }
      await cleanupRuntime(runtimeDir);
      reportProgress("scaffolding", 1, 4, "Creating Astro structure...");
      if (context.page_tree) {
        await translatePageTree(context.page_tree, `${runtimeDir}/src/content`);
      } else {
        await createAstroStructure(
          context.project_path,
          context.project_info,
          runtimeDir,
          context.moss_dir
        );
      }
      await createAstroConfig(
        context.site_config,
        runtimeDir,
        context.project_path
      );
      await createDefaultLayouts(runtimeDir, context.project_path);
      reportProgress("building", 2, 4, "Installing Astro dependencies...");
      const installResult = await executeBinary({
        binaryPath: "npm",
        args: ["install", "--prefix", runtimeDir],
        timeoutMs: 3e5
      });
      if (!installResult.success) {
        return {
          success: false,
          message: `Failed to install Astro dependencies: ${installResult.stderr}`
        };
      }
      reportProgress("building", 3, 4, "Running Astro build...");
      const result = await executeBinary({
        binaryPath: npxPath,
        args: [
          "--prefix",
          runtimeDir,
          "astro",
          "build",
          "--outDir",
          context.output_dir,
          ...buildArgs
        ],
        timeoutMs: 3e5
      });
      if (!result.success) {
        const errorMessage = result.stderr || `Astro exited with code ${result.exitCode}`;
        return {
          success: false,
          message: `Astro build failed: ${errorMessage}`
        };
      }
      reportProgress("complete", 4, 4, "Astro build complete");
      return { success: true, message: "Astro build complete" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to execute Astro: ${errorMessage}`
      };
    } finally {
      await cleanupRuntime(runtimeDir);
    }
  }
  var AstroGenerator = { on_build };
  window.AstroGenerator = AstroGenerator;
  var main_default = AstroGenerator;
  return __toCommonJS(main_exports);
})();
