"use strict";
var JekyllPlugin = (() => {
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
  async function createJekyllStructure(projectPath, projectInfo, runtimeDir, _mossDir) {
    const runtimeRelative = getRelativePath(projectPath, runtimeDir);
    if (projectInfo.homepage_file) {
      const homepageExists = await fileExists(projectInfo.homepage_file);
      if (homepageExists) {
        await createSymlink(projectInfo.homepage_file, `${runtimeRelative}/index.md`);
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
        let destPath;
        if (folder === "posts" || folder === "_posts") {
          destPath = `${runtimeRelative}/_posts/${relativePath}`;
        } else {
          destPath = `${runtimeRelative}/${folder}/${relativePath}`;
        }
        await createSymlink(file, destPath);
      }
    }
    const rootMarkdownFiles = markdownFiles.filter(
      (f) => !f.includes("/") && // No subdirectory
      f !== projectInfo.homepage_file
    );
    for (const file of rootMarkdownFiles) {
      await createSymlink(file, `${runtimeRelative}/${file}`);
    }
    const assetFiles = allFiles.filter((f) => f.startsWith("assets/"));
    for (const file of assetFiles) {
      await createSymlink(file, `${runtimeRelative}/${file}`);
    }
  }
  async function translatePageTree(node, outputDir) {
    if (node.draft) return;
    if (node.is_folder) {
      const jekyllPath = node.source_path ? remapPostsPath(node.source_path) : "";
      const folderPath = jekyllPath ? `${outputDir}/${jekyllPath}` : outputDir;
      const indexPath = `${folderPath}/index.md`;
      const frontmatterLines = [`title: "${node.title}"`];
      if (node.nav_weight !== void 0) {
        frontmatterLines.push(`order: ${node.nav_weight}`);
      }
      if (node.nav) {
        frontmatterLines.push(`nav: true`);
      }
      if (node.list_style && node.list_style !== "list") {
        frontmatterLines.push(`list_style: "${node.list_style}"`);
      }
      const frontmatter = `---
${frontmatterLines.join("\n")}
---
`;
      const body = node.content_html || "";
      await writeFile(indexPath, frontmatter + body);
      for (const child of node.children) {
        await translatePageTree(child, outputDir);
      }
    } else {
      const destPath = remapPostsPath(node.source_path);
      await createSymlink(node.source_path, `${outputDir}/${destPath}`);
    }
  }
  function remapPostsPath(sourcePath) {
    if (sourcePath.startsWith("posts/")) {
      return "_posts/" + sourcePath.substring("posts/".length);
    }
    return sourcePath;
  }
  async function createJekyllConfig(siteConfig, runtimeDir, projectPath) {
    const siteName = siteConfig.site_name || "Site";
    const baseUrl = siteConfig.base_url || "";
    const runtimeRelative = getRelativePath(projectPath, runtimeDir);
    const config = `# Auto-generated Jekyll configuration
# Do not edit - this file is regenerated on each build

title: "${siteName}"
baseurl: "${baseUrl}"
url: ""

# Markdown processor
markdown: kramdown
kramdown:
  input: GFM
  hard_wrap: false
  syntax_highlighter: rouge

# Permalink structure
permalink: /:categories/:title/

# Build settings
exclude:
  - Gemfile
  - Gemfile.lock
  - node_modules
  - vendor

# Allow raw HTML in markdown
kramdown:
  parse_block_html: true
`;
    await writeFile(`${runtimeRelative}/_config.yml`, config);
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

  // src/templates.ts
  async function createDefaultLayouts(runtimeDir, projectPath) {
    const runtimeRelative = getRelativePath2(projectPath, runtimeDir);
    const layoutsDir = `${runtimeRelative}/_layouts`;
    await writeFile(
      `${layoutsDir}/default.html`,
      `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{% if page.title %}{{ page.title }} | {% endif %}{{ site.title }}</title>
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
      <a href="{{ site.baseurl }}/">Home</a>
    </nav>
  </header>
  <main>
    {{ content }}
  </main>
  <footer>
    <p>&copy; {{ site.time | date: '%Y' }} {{ site.title }}</p>
  </footer>
</body>
</html>
`
    );
    await writeFile(
      `${layoutsDir}/page.html`,
      `---
layout: default
---
<article>
  <h1>{{ page.title }}</h1>
  {{ content }}
</article>
`
    );
    await writeFile(
      `${layoutsDir}/post.html`,
      `---
layout: default
---
<article>
  <header>
    <h1>{{ page.title }}</h1>
    <time datetime="{{ page.date | date_to_xmlschema }}">
      {{ page.date | date: "%B %d, %Y" }}
    </time>
  </header>
  {{ content }}
</article>
`
    );
    await writeFile(
      `${layoutsDir}/home.html`,
      `---
layout: default
---
{{ content }}

{% if site.posts.size > 0 %}
<section>
  <h2>Recent Posts</h2>
  <ul>
    {% for post in site.posts limit:10 %}
    <li>
      <a href="{{ post.url | relative_url }}">{{ post.title }}</a>
      <time datetime="{{ post.date | date_to_xmlschema }}">
        {{ post.date | date: "%B %d, %Y" }}
      </time>
    </li>
    {% endfor %}
  </ul>
</section>
{% endif %}
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

  // src/jekyll-config.ts
  var JEKYLL_BINARY_CONFIG = {
    name: "jekyll",
    binary_name: "jekyll",
    version_check: {
      args: ["--version"],
      pattern: "jekyll\\s+(\\d+\\.\\d+\\.\\d+)"
    },
    sources: {}
  };

  // src/main.ts
  async function on_build(context) {
    const buildArgs = context.config.build_args || [];
    const runtimeDir = `${context.moss_dir}/plugins/jekyll-generator/.runtime`;
    try {
      reportProgress("setup", 0, 4, "Resolving Jekyll binary...");
      let jekyllPath;
      try {
        const jekyllResolution = await resolveBinary(JEKYLL_BINARY_CONFIG, {
          configuredPath: context.config.jekyll_path,
          autoDownload: false,
          // Jekyll cannot be auto-downloaded (Ruby gem)
          onProgress: (binary, bytesDownloaded, totalBytes) => {
            const total = totalBytes ? `/${totalBytes}` : "";
            reportProgress("setup", 0, 4, `Downloading ${binary}: ${bytesDownloaded}${total} bytes`);
          }
        });
        jekyllPath = jekyllResolution.path;
        if (jekyllResolution.version) {
          reportProgress(
            "setup",
            0,
            4,
            `Using Jekyll ${jekyllResolution.version} from ${jekyllResolution.source}`
          );
        }
      } catch (error) {
        if (error instanceof BinaryResolutionError) {
          return {
            success: false,
            message: `Jekyll setup failed: ${error.message}. Install with: gem install jekyll bundler`
          };
        }
        throw error;
      }
      await cleanupRuntime(runtimeDir);
      reportProgress("scaffolding", 1, 4, "Creating Jekyll structure...");
      if (context.page_tree) {
        await translatePageTree(context.page_tree, runtimeDir);
      } else {
        await createJekyllStructure(
          context.project_path,
          context.project_info,
          runtimeDir,
          context.moss_dir
        );
      }
      await createJekyllConfig(
        context.site_config,
        runtimeDir,
        context.project_path
      );
      await createDefaultLayouts(runtimeDir, context.project_path);
      reportProgress("building", 2, 4, "Running Jekyll...");
      const result = await executeBinary({
        binaryPath: jekyllPath,
        args: [
          "build",
          "--source",
          runtimeDir,
          "--destination",
          context.output_dir,
          "--quiet",
          ...buildArgs
        ],
        timeoutMs: 3e5
        // 5 minutes for large sites
      });
      if (!result.success) {
        const errorMessage = result.stderr || `Jekyll exited with code ${result.exitCode}`;
        return {
          success: false,
          message: `Jekyll build failed: ${errorMessage}`
        };
      }
      reportProgress("complete", 4, 4, "Jekyll build complete");
      return { success: true, message: "Jekyll build complete" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to execute Jekyll: ${errorMessage}`
      };
    } finally {
      await cleanupRuntime(runtimeDir);
    }
  }
  var JekyllGenerator = { on_build };
  window.JekyllGenerator = JekyllGenerator;
  var main_default = JekyllGenerator;
  return __toCommonJS(main_exports);
})();
