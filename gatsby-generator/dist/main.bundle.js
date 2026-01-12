"use strict";
var GatsbyGenerator = (() => {
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

  // src/main.ts
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
  async function readPluginFile(relativePath) {
    const ctx = getInternalContext();
    return getTauriCore().invoke("read_plugin_file", {
      pluginName: ctx.plugin_name,
      projectPath: ctx.project_path,
      relativePath
    });
  }
  async function writePluginFile(relativePath, content) {
    const ctx = getInternalContext();
    await getTauriCore().invoke("write_plugin_file", {
      pluginName: ctx.plugin_name,
      projectPath: ctx.project_path,
      relativePath,
      content
    });
  }
  async function pluginFileExists(relativePath) {
    const ctx = getInternalContext();
    return getTauriCore().invoke("plugin_file_exists", {
      pluginName: ctx.plugin_name,
      projectPath: ctx.project_path,
      relativePath
    });
  }
  async function fetchUrl(url, options = {}) {
    const { timeoutMs = 3e4 } = options;
    const result = await getTauriCore().invoke("fetch_url", {
      url,
      timeoutMs
    });
    const binaryString = atob(result.body_base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    return {
      status: result.status,
      ok: result.ok,
      contentType: result.content_type,
      body: bytes,
      text() {
        return new TextDecoder().decode(bytes);
      }
    };
  }
  async function executeBinary(options) {
    const ctx = getInternalContext();
    const { binaryPath, args, timeoutMs = 6e4, env } = options;
    const result = await getTauriCore().invoke("execute_binary", {
      binaryPath,
      args,
      workingDir: ctx.project_path,
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
  var cachedPlatform = null;
  async function getPlatformInfo() {
    if (cachedPlatform) return cachedPlatform;
    const os = await detectOS();
    const arch = await detectArch(os);
    const platformKey = `${os}-${arch}`;
    const supportedPlatforms = [
      "darwin-arm64",
      "darwin-x64",
      "linux-x64",
      "windows-x64"
    ];
    if (!supportedPlatforms.includes(platformKey)) throw new Error(`Unsupported platform: ${platformKey}. Supported platforms: ${supportedPlatforms.join(", ")}`);
    cachedPlatform = {
      os,
      arch,
      platformKey
    };
    return cachedPlatform;
  }
  async function detectOS() {
    try {
      const result = await executeBinary({
        binaryPath: "uname",
        args: ["-s"],
        timeoutMs: 5e3
      });
      if (result.success) {
        const osName = result.stdout.trim().toLowerCase();
        if (osName === "darwin") return "darwin";
        if (osName === "linux") return "linux";
      }
    } catch {
    }
    try {
      const result = await executeBinary({
        binaryPath: "cmd",
        args: ["/c", "ver"],
        timeoutMs: 5e3
      });
      if (result.success && result.stdout.toLowerCase().includes("windows")) return "windows";
    } catch {
    }
    throw new Error("Unable to detect operating system. Supported systems: macOS (Darwin), Linux, Windows");
  }
  async function detectArch(os) {
    if (os === "windows") try {
      const result = await executeBinary({
        binaryPath: "cmd",
        args: [
          "/c",
          "echo",
          "%PROCESSOR_ARCHITECTURE%"
        ],
        timeoutMs: 5e3
      });
      if (result.success) {
        if (result.stdout.trim().toLowerCase() === "arm64") return "arm64";
        return "x64";
      }
    } catch {
      return "x64";
    }
    try {
      const result = await executeBinary({
        binaryPath: "uname",
        args: ["-m"],
        timeoutMs: 5e3
      });
      if (result.success) {
        const machine = result.stdout.trim().toLowerCase();
        if (machine === "arm64" || machine === "aarch64") return "arm64";
        if (machine === "x86_64" || machine === "amd64") return "x64";
        if (machine.includes("arm")) return "arm64";
        return "x64";
      }
    } catch {
    }
    return "x64";
  }
  async function extractArchive(options) {
    const { archivePath, destDir, timeoutMs = 6e4 } = options;
    const format = options.format ?? detectFormat(archivePath);
    if (!format) return {
      success: false,
      error: `Unable to detect archive format for: ${archivePath}. Supported formats: .tar.gz, .zip`
    };
    const platform = await getPlatformInfo();
    try {
      if (format === "tar.gz") return await extractTarGz(archivePath, destDir, timeoutMs);
      else if (platform.os === "windows") return await extractZipWindows(archivePath, destDir, timeoutMs);
      else return await extractZipUnix(archivePath, destDir, timeoutMs);
    } catch (error$1) {
      return {
        success: false,
        error: error$1 instanceof Error ? error$1.message : String(error$1)
      };
    }
  }
  async function makeExecutable(filePath) {
    if ((await getPlatformInfo()).os === "windows") return true;
    try {
      return (await executeBinary({
        binaryPath: "chmod",
        args: ["+x", filePath],
        timeoutMs: 5e3
      })).success;
    } catch {
      return false;
    }
  }
  function detectFormat(archivePath) {
    const lowerPath = archivePath.toLowerCase();
    if (lowerPath.endsWith(".tar.gz") || lowerPath.endsWith(".tgz")) return "tar.gz";
    if (lowerPath.endsWith(".zip")) return "zip";
    return null;
  }
  async function extractTarGz(archivePath, destDir, timeoutMs) {
    const result = await executeBinary({
      binaryPath: "tar",
      args: [
        "-xzf",
        archivePath,
        "-C",
        destDir
      ],
      timeoutMs
    });
    if (!result.success) return {
      success: false,
      error: result.stderr || `tar extraction failed with exit code ${result.exitCode}`
    };
    return { success: true };
  }
  async function extractZipUnix(archivePath, destDir, timeoutMs) {
    const result = await executeBinary({
      binaryPath: "unzip",
      args: [
        "-o",
        "-q",
        archivePath,
        "-d",
        destDir
      ],
      timeoutMs
    });
    if (!result.success) return {
      success: false,
      error: result.stderr || `unzip extraction failed with exit code ${result.exitCode}`
    };
    return { success: true };
  }
  async function extractZipWindows(archivePath, destDir, timeoutMs) {
    const result = await executeBinary({
      binaryPath: "powershell",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force`
      ],
      timeoutMs
    });
    if (!result.success) return {
      success: false,
      error: result.stderr || `PowerShell extraction failed with exit code ${result.exitCode}`
    };
    return { success: true };
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
    const progress = (phase, message) => {
      onProgress?.(phase, message);
    };
    if (configuredPath) {
      progress("detection", `Checking configured path: ${configuredPath}`);
      const result = await checkBinary(configuredPath, config);
      if (result) return {
        path: configuredPath,
        version: result.version,
        source: "config"
      };
    }
    progress("detection", `Checking system PATH for ${config.name}`);
    const pathResult = await checkBinary(config.name, config);
    if (pathResult) return {
      path: config.name,
      version: pathResult.version,
      source: "path"
    };
    const pluginBinPath = await getPluginBinPath(config);
    progress("detection", `Checking plugin storage: ${pluginBinPath}`);
    if (await binaryExistsInPluginStorage(config)) {
      const storedResult = await checkBinary(pluginBinPath, config);
      if (storedResult) return {
        path: pluginBinPath,
        version: storedResult.version,
        source: "plugin-storage"
      };
    }
    if (!autoDownload) throw new BinaryResolutionError(`${config.name} not found. Please install it manually or set the path in plugin configuration.

Installation options:
- Install via package manager (brew, apt, etc.)
- Download from the official website
- Set ${config.name}_path in .moss/config.toml`, "detection");
    progress("download", `Downloading ${config.name}...`);
    const downloadedPath = await downloadBinary(config, progress);
    const downloadedResult = await checkBinary(downloadedPath, config);
    if (!downloadedResult) throw new BinaryResolutionError(`Downloaded ${config.name} binary failed verification. The binary may be corrupted or incompatible with your system.`, "validation");
    return {
      path: downloadedPath,
      version: downloadedResult.version,
      source: "downloaded"
    };
  }
  async function checkBinary(binaryPath, config) {
    try {
      const [cmd, ...args] = parseCommand(config.versionCommand ?? `${config.name} version`, binaryPath, config.name);
      const result = await executeBinary({
        binaryPath: cmd,
        args,
        timeoutMs: 1e4
      });
      if (!result.success) return null;
      let version;
      if (config.versionPattern) {
        const match = (result.stdout + result.stderr).match(config.versionPattern);
        if (match && match[1]) version = match[1];
      }
      return { version };
    } catch {
      return null;
    }
  }
  function parseCommand(template, binaryPath, name) {
    const resolved = template.replace(/{name}/g, binaryPath);
    if (resolved.startsWith(binaryPath)) return [binaryPath, ...resolved.slice(binaryPath.length).trim().split(/\s+/).filter(Boolean)];
    return resolved.split(/\s+/).filter(Boolean);
  }
  async function getPluginBinPath(config) {
    const ctx = getInternalContext();
    const binaryName = getBinaryFilename(config, (await getPlatformInfo()).os === "windows");
    return `${ctx.moss_dir}/plugins/${ctx.plugin_name}/bin/${binaryName}`;
  }
  function getBinaryFilename(config, isWindows) {
    const baseName = config.binaryName ?? config.name;
    return isWindows ? `${baseName}.exe` : baseName;
  }
  async function binaryExistsInPluginStorage(config) {
    return pluginFileExists(`bin/${getBinaryFilename(config, (await getPlatformInfo()).os === "windows")}`);
  }
  async function downloadBinary(config, progress) {
    const platform = await getPlatformInfo();
    const source = config.sources[platform.platformKey];
    if (!source) throw new BinaryResolutionError(`No download source configured for platform: ${platform.platformKey}`, "download");
    let version;
    let downloadUrl;
    if (source.github) {
      progress("download", "Fetching latest release info from GitHub...");
      version = (await getLatestRelease(source.github.owner, source.github.repo)).version;
      const assetName = resolveAssetPattern(source.github.assetPattern, version, platform);
      downloadUrl = `https://github.com/${source.github.owner}/${source.github.repo}/releases/download/v${version}/${assetName}`;
    } else if (source.directUrl) {
      downloadUrl = source.directUrl;
      const versionMatch = downloadUrl.match(/[/v_](\d+\.\d+\.\d+)[/_]/);
      version = versionMatch ? versionMatch[1] : "unknown";
      progress("download", `Using direct download URL (v${version})...`);
    } else throw new BinaryResolutionError(`No download source configured for ${config.name}`, "download");
    progress("download", `Downloading ${config.name} v${version}...`);
    const ctx = getInternalContext();
    const archiveFilename = downloadUrl.split("/").pop() ?? "archive";
    const archivePath = `${ctx.moss_dir}/plugins/${ctx.plugin_name}/.tmp/${archiveFilename}`;
    await downloadToPluginStorage(downloadUrl, `.tmp/${archiveFilename}`);
    progress("extraction", "Extracting archive...");
    const binDir = `${ctx.moss_dir}/plugins/${ctx.plugin_name}/bin`;
    await writePluginFile("bin/.gitkeep", "");
    const extractResult = await extractArchive({
      archivePath,
      destDir: binDir
    });
    if (!extractResult.success) throw new BinaryResolutionError(`Failed to extract archive: ${extractResult.error}`, "extraction");
    const binaryPath = await getPluginBinPath(config);
    await makeExecutable(binaryPath);
    progress("complete", `${config.name} v${version} installed successfully`);
    await cacheReleaseInfo(config.name, version);
    return binaryPath;
  }
  async function getLatestRelease(owner, repo) {
    const cacheKey = `${owner}/${repo}`;
    try {
      const response = await fetchUrl(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, { timeoutMs: 1e4 });
      if (!response.ok) {
        if (response.status === 403 || response.status === 429) {
          const cached = await getCachedRelease(cacheKey);
          if (cached) return cached;
          throw new BinaryResolutionError("GitHub API rate limit exceeded. Please try again later or install the binary manually.", "download");
        }
        throw new BinaryResolutionError(`Failed to fetch release info: HTTP ${response.status}`, "download");
      }
      const tag = JSON.parse(response.text()).tag_name;
      return {
        version: tag.replace(/^v/, ""),
        tag
      };
    } catch (error$1) {
      if (error$1 instanceof BinaryResolutionError) throw error$1;
      const cached = await getCachedRelease(cacheKey);
      if (cached) return cached;
      throw new BinaryResolutionError(`Failed to fetch release info: ${error$1 instanceof Error ? error$1.message : String(error$1)}`, "download", error$1 instanceof Error ? error$1 : void 0);
    }
  }
  function resolveAssetPattern(pattern, version, platform) {
    return pattern.replace(/{version}/g, version).replace(/{os}/g, platform.os).replace(/{arch}/g, {
      x64: "amd64",
      arm64: "arm64"
    }[platform.arch] ?? platform.arch);
  }
  async function downloadToPluginStorage(url, relativePath) {
    const ctx = getInternalContext();
    const platform = await getPlatformInfo();
    const targetPath = `${ctx.moss_dir}/plugins/${ctx.plugin_name}/${relativePath}`;
    const parentDir = targetPath.substring(0, targetPath.lastIndexOf("/"));
    if (platform.os === "windows") {
      await executeBinary({
        binaryPath: "powershell",
        args: [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `New-Item -ItemType Directory -Force -Path '${parentDir}'`
        ],
        timeoutMs: 5e3
      });
      const result = await executeBinary({
        binaryPath: "powershell",
        args: [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Invoke-WebRequest -Uri '${url}' -OutFile '${targetPath}'`
        ],
        timeoutMs: 3e5
      });
      if (!result.success) throw new BinaryResolutionError(`Download failed: ${result.stderr || result.stdout}`, "download");
    } else {
      await executeBinary({
        binaryPath: "mkdir",
        args: ["-p", parentDir],
        timeoutMs: 5e3
      });
      const result = await executeBinary({
        binaryPath: "curl",
        args: [
          "-fsSL",
          "--create-dirs",
          "-o",
          targetPath,
          url
        ],
        timeoutMs: 3e5
      });
      if (!result.success) throw new BinaryResolutionError(`Download failed: ${result.stderr || `curl exited with code ${result.exitCode}`}`, "download");
    }
  }
  async function cacheReleaseInfo(name, version) {
    try {
      const cached = {
        version,
        tag: `v${version}`,
        cachedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      await writePluginFile(`cache/${name}-release.json`, JSON.stringify(cached, null, 2));
    } catch {
    }
  }
  async function getCachedRelease(cacheKey) {
    try {
      const name = cacheKey.split("/")[1];
      if (!name) return null;
      if (!await pluginFileExists(`cache/${name}-release.json`)) return null;
      const content = await readPluginFile(`cache/${name}-release.json`);
      const cached = JSON.parse(content);
      return {
        version: cached.version,
        tag: cached.tag
      };
    } catch {
      return null;
    }
  }

  // src/structure.ts
  function parseMarkdownContent(content) {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    let bodyContent = content;
    let extractedTitle = "Page";
    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];
      const titleMatch = frontmatter.match(/title:\s*["']?([^"'\n]+)["']?/);
      if (titleMatch) {
        extractedTitle = titleMatch[1];
      }
      bodyContent = content.substring(frontmatterMatch[0].length).trim();
    }
    return { title: extractedTitle, body: bodyContent };
  }
  function wrapInGatsbyPage(content, title) {
    const parsed = parseMarkdownContent(content);
    const pageTitle = title || parsed.title;
    const escapedBody = parsed.body.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
    return `import * as React from "react"
import Layout from "../components/Layout"

const Page = () => {
  return (
    <Layout title="${pageTitle}">
      <article>
        <div dangerouslySetInnerHTML={{ __html: \`${escapedBody.split("\n").map((line) => line).join("\n")}\` }} />
      </article>
    </Layout>
  )
}

export default Page

export const Head = () => <title>${pageTitle}</title>
`;
  }
  async function createGatsbyStructure(projectPath, projectInfo, runtimeDir, _mossDir) {
    const runtimeRelative = getRelativePath(projectPath, runtimeDir);
    if (projectInfo.homepage_file) {
      const homepageExists = await fileExists(projectInfo.homepage_file);
      if (homepageExists) {
        const content = await readFile(projectInfo.homepage_file);
        const gatsbyContent = wrapInGatsbyPage(content, "Home");
        await writeFile(`${runtimeRelative}/src/pages/index.js`, gatsbyContent);
      }
    }
    const allFiles = await listFiles();
    const markdownFiles = allFiles.filter((f) => f.endsWith(".md"));
    for (const folder of projectInfo.content_folders) {
      const folderFiles = markdownFiles.filter(
        (f) => f.startsWith(`${folder}/`)
      );
      for (const file of folderFiles) {
        const content = await readFile(file);
        const relativePath = file.substring(folder.length + 1);
        await writeFile(`${runtimeRelative}/src/content/${folder}/${relativePath}`, content);
      }
    }
    const rootMarkdownFiles = markdownFiles.filter(
      (f) => !f.includes("/") && f !== projectInfo.homepage_file
    );
    for (const file of rootMarkdownFiles) {
      const content = await readFile(file);
      const baseName = file.replace(/\.md$/, "");
      const gatsbyContent = wrapInGatsbyPage(content, baseName);
      await writeFile(`${runtimeRelative}/src/pages/${baseName}.js`, gatsbyContent);
    }
    const assetFiles = allFiles.filter((f) => f.startsWith("assets/"));
    for (const file of assetFiles) {
      if (isTextFile(file)) {
        try {
          const content = await readFile(file);
          await writeFile(`${runtimeRelative}/static/${file}`, content);
        } catch {
        }
      }
    }
  }
  async function createGatsbyConfig(siteConfig, runtimeDir, projectPath) {
    const siteName = siteConfig.site_name || "Site";
    const baseUrl = siteConfig.base_url || "/";
    const runtimeRelative = getRelativePath(projectPath, runtimeDir);
    const config = `// Auto-generated Gatsby configuration
module.exports = {
  siteMetadata: {
    title: \`${siteName}\`,
    siteUrl: \`${baseUrl === "/" ? "https://example.com" : baseUrl}\`,
  },
  pathPrefix: \`${baseUrl === "/" ? "" : baseUrl}\`,
  plugins: [
    \`gatsby-transformer-remark\`,
    {
      resolve: \`gatsby-source-filesystem\`,
      options: {
        name: \`content\`,
        path: \`\${__dirname}/src/content\`,
      },
    },
    {
      resolve: \`gatsby-source-filesystem\`,
      options: {
        name: \`pages\`,
        path: \`\${__dirname}/src/pages\`,
      },
    },
  ],
}
`;
    await writeFile(`${runtimeRelative}/gatsby-config.js`, config);
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
  function isTextFile(filePath) {
    const textExtensions = [
      ".md",
      ".txt",
      ".css",
      ".js",
      ".json",
      ".html",
      ".xml",
      ".svg",
      ".yaml",
      ".yml",
      ".toml",
      ".mjs",
      ".ts"
    ];
    const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
    return textExtensions.includes(ext);
  }

  // src/templates.ts
  async function createDefaultLayouts(runtimeDir, projectPath) {
    const runtimeRelative = getRelativePath2(projectPath, runtimeDir);
    await writeFile(
      `${runtimeRelative}/src/components/Layout.js`,
      `import * as React from "react"

const Layout = ({ title, children }) => {
  return (
    <>
      <style>
        {\`
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
        \`}
      </style>
      <header>
        <nav>
          <a href="/">Home</a>
        </nav>
      </header>
      <main>
        {children}
      </main>
      <footer>
        <p>&copy; {new Date().getFullYear()}</p>
      </footer>
    </>
  )
}

export default Layout
`
    );
    await writeFile(
      `${runtimeRelative}/package.json`,
      `{
  "name": "gatsby-site",
  "version": "0.0.1",
  "scripts": {
    "build": "gatsby build"
  },
  "dependencies": {
    "gatsby": "^5.0.0",
    "gatsby-source-filesystem": "^5.0.0",
    "gatsby-transformer-remark": "^6.0.0",
    "react": "^18.0.0",
    "react-dom": "^18.0.0"
  }
}
`
    );
    await writeFile(
      `${runtimeRelative}/src/content/.gitkeep`,
      ``
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

  // src/gatsby-config.ts
  var GATSBY_BINARY_CONFIG = {
    name: "npx",
    displayName: "npx (for Gatsby)",
    versionCommand: ["--version"],
    versionPattern: /(\d+\.\d+\.\d+)/,
    platforms: {},
    installInstructions: {
      darwin: "Install Node.js from nodejs.org or via: brew install node",
      linux: "Install Node.js from nodejs.org or via: apt install nodejs npm",
      win32: "Install Node.js from nodejs.org"
    }
  };

  // src/main.ts
  async function on_build(context) {
    const buildArgs = context.config.build_args || [];
    const runtimeDir = `${context.moss_dir}/plugins/gatsby-generator/.runtime`;
    try {
      reportProgress("setup", 0, 4, "Resolving npx binary...");
      let npxPath;
      try {
        const npxResolution = await resolveBinary(GATSBY_BINARY_CONFIG, {
          autoDownload: false,
          onProgress: (phase, message) => {
            reportProgress(phase, 0, 4, message);
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
            message: `Gatsby setup failed: ${error.message}. Install Node.js from nodejs.org`
          };
        }
        throw error;
      }
      await cleanupRuntime(runtimeDir);
      reportProgress("scaffolding", 1, 4, "Creating Gatsby structure...");
      await createGatsbyStructure(
        context.project_path,
        context.project_info,
        runtimeDir,
        context.moss_dir
      );
      await createGatsbyConfig(
        context.site_config,
        runtimeDir,
        context.project_path
      );
      await createDefaultLayouts(runtimeDir, context.project_path);
      reportProgress("building", 2, 4, "Installing Gatsby dependencies...");
      const installResult = await executeBinary({
        binaryPath: "npm",
        args: ["install", "--prefix", runtimeDir],
        timeoutMs: 3e5
      });
      if (!installResult.success) {
        return {
          success: false,
          message: `Failed to install Gatsby dependencies: ${installResult.stderr}`
        };
      }
      reportProgress("building", 3, 4, "Running Gatsby build...");
      const result = await executeBinary({
        binaryPath: npxPath,
        args: [
          "--prefix",
          runtimeDir,
          "gatsby",
          "build",
          "--prefix-paths",
          ...buildArgs
        ],
        timeoutMs: 3e5,
        env: {
          // Gatsby 5+ respects this env var for output directory
          GATSBY_BUILD_OUTPUT_DIR: context.output_dir
        }
      });
      if (!result.success) {
        const errorMessage = result.stderr || `Gatsby exited with code ${result.exitCode}`;
        return {
          success: false,
          message: `Gatsby build failed: ${errorMessage}`
        };
      }
      reportProgress("complete", 4, 4, "Gatsby build complete");
      return { success: true, message: "Gatsby build complete" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to execute Gatsby: ${errorMessage}`
      };
    } finally {
      await cleanupRuntime(runtimeDir);
    }
  }
  var GatsbyGenerator = { on_build };
  window.GatsbyGenerator = GatsbyGenerator;
  var main_default = GatsbyGenerator;
  return __toCommonJS(main_exports);
})();
