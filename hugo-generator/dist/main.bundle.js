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
  async function readFile(projectPath, relativePath) {
    return getTauriCore().invoke("read_project_file", {
      projectPath,
      relativePath
    });
  }
  async function writeFile(projectPath, relativePath, content) {
    await getTauriCore().invoke("write_project_file", {
      projectPath,
      relativePath,
      data: content
    });
  }
  async function listFiles(projectPath) {
    return getTauriCore().invoke("list_project_files", { projectPath });
  }
  async function fileExists(projectPath, relativePath) {
    try {
      await readFile(projectPath, relativePath);
      return true;
    } catch {
      return false;
    }
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

  // dist/structure.js
  async function createHugoStructure(projectPath, projectInfo, runtimeDir, _mossDir) {
    const runtimeRelative = getRelativePath(projectPath, runtimeDir);
    const contentDir = `${runtimeRelative}/content`;
    const staticDir = `${runtimeRelative}/static`;
    if (projectInfo.homepage_file) {
      const homepageExists = await fileExists(projectPath, projectInfo.homepage_file);
      if (homepageExists) {
        const content = await readFile(projectPath, projectInfo.homepage_file);
        await writeFile(projectPath, `${contentDir}/_index.md`, content);
      }
    }
    const allFiles = await listFiles(projectPath);
    const markdownFiles = allFiles.filter((f) => f.endsWith(".md"));
    for (const folder of projectInfo.content_folders) {
      const folderFiles = markdownFiles.filter((f) => f.startsWith(`${folder}/`));
      for (const file of folderFiles) {
        const content = await readFile(projectPath, file);
        const relativePath = file.substring(folder.length + 1);
        const fileName = getFileName(relativePath);
        let destPath;
        if (fileName.toLowerCase() === "index.md") {
          const dirPart = getDirName(relativePath);
          destPath = dirPart ? `${contentDir}/${folder}/${dirPart}/_index.md` : `${contentDir}/${folder}/_index.md`;
        } else {
          destPath = `${contentDir}/${folder}/${relativePath}`;
        }
        await writeFile(projectPath, destPath, content);
      }
    }
    const rootMarkdownFiles = markdownFiles.filter((f) => !f.includes("/") && // No subdirectory
    f !== projectInfo.homepage_file);
    for (const file of rootMarkdownFiles) {
      const content = await readFile(projectPath, file);
      await writeFile(projectPath, `${contentDir}/${file}`, content);
    }
    const assetFiles = allFiles.filter((f) => f.startsWith("assets/"));
    for (const file of assetFiles) {
      if (isTextFile(file)) {
        try {
          const content = await readFile(projectPath, file);
          await writeFile(projectPath, `${staticDir}/${file}`, content);
        } catch {
        }
      }
    }
  }
  async function createHugoConfig(siteConfig, runtimeDir, projectPath) {
    const siteName = siteConfig.site_name || "Site";
    const baseUrl = siteConfig.base_url || "/";
    const runtimeRelative = getRelativePath(projectPath, runtimeDir);
    const config = `# Auto-generated Hugo configuration
# Do not edit - this file is regenerated on each build

baseURL = "${baseUrl}"
title = "${siteName}"

# Preserve folder structure in URLs
[permalinks]
  [permalinks.page]
    '*' = '/:sections/:filename/'
  [permalinks.section]
    '*' = '/:sections/'

# Disable features we don't need
disableKinds = ["taxonomy", "term", "RSS", "sitemap"]

# Enable goldmark for markdown
[markup]
  [markup.goldmark]
    [markup.goldmark.renderer]
      unsafe = true
`;
    await writeFile(projectPath, `${runtimeRelative}/hugo.toml`, config);
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
  function getFileName(filePath) {
    const parts = filePath.split("/");
    return parts[parts.length - 1];
  }
  function getDirName(filePath) {
    const parts = filePath.split("/");
    if (parts.length <= 1) {
      return "";
    }
    return parts.slice(0, -1).join("/");
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
      ".toml"
    ];
    const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
    return textExtensions.includes(ext);
  }

  // dist/templates.js
  var BASEOF_HTML = `<!DOCTYPE html>
<html lang="{{ site.Language.Lang | default "en" }}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{ .Title }}{{ with site.Title }} | {{ . }}{{ end }}</title>
  {{ with .Description }}<meta name="description" content="{{ . }}">{{ end }}
  {{ $styles := resources.Get "css/style.css" }}
  {{ with $styles }}<link rel="stylesheet" href="{{ .RelPermalink }}">{{ end }}
</head>
<body>
  {{ block "main" . }}{{ end }}
</body>
</html>
`;
  var SINGLE_HTML = `{{ define "main" }}
<article>
  <header>
    <h1>{{ .Title }}</h1>
    {{ with .Date }}<time datetime="{{ .Format "2006-01-02" }}">{{ .Format "January 2, 2006" }}</time>{{ end }}
  </header>
  <div class="content">
    {{ .Content }}
  </div>
</article>
{{ end }}
`;
  var LIST_HTML = `{{ define "main" }}
<section>
  <h1>{{ .Title }}</h1>
  {{ .Content }}
  {{ if .Pages }}
  <ul class="page-list">
    {{ range .Pages }}
    <li>
      <a href="{{ .RelPermalink }}">{{ .Title }}</a>
      {{ with .Summary }}<p>{{ . }}</p>{{ end }}
    </li>
    {{ end }}
  </ul>
  {{ end }}
</section>
{{ end }}
`;
  var INDEX_HTML = `{{ define "main" }}
<main class="homepage">
  {{ .Content }}
</main>
{{ end }}
`;
  async function createDefaultLayouts(runtimeDir, projectPath) {
    const runtimeRelative = getRelativePath2(projectPath, runtimeDir);
    const layoutsDir = `${runtimeRelative}/layouts`;
    const defaultDir = `${layoutsDir}/_default`;
    await Promise.all([
      writeFile(projectPath, `${defaultDir}/baseof.html`, BASEOF_HTML),
      writeFile(projectPath, `${defaultDir}/single.html`, SINGLE_HTML),
      writeFile(projectPath, `${defaultDir}/list.html`, LIST_HTML),
      writeFile(projectPath, `${layoutsDir}/index.html`, INDEX_HTML)
    ]);
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

  // dist/main.js
  async function on_build(context) {
    const hugoPath = context.config.hugo_path || "hugo";
    const buildArgs = context.config.build_args || ["--minify"];
    const runtimeDir = `${context.moss_dir}/plugins/hugo-generator/.runtime`;
    try {
      await cleanupRuntime(runtimeDir);
      reportProgress("scaffolding", 0, 3, "Creating Hugo structure...");
      await createHugoStructure(context.project_path, context.project_info, runtimeDir, context.moss_dir);
      await createHugoConfig(context.site_config, runtimeDir, context.project_path);
      await createDefaultLayouts(runtimeDir, context.project_path);
      reportProgress("building", 1, 3, "Running Hugo...");
      const result = await executeBinary({
        binaryPath: hugoPath,
        args: [
          "--source",
          runtimeDir,
          "--destination",
          context.output_dir,
          "--quiet",
          ...buildArgs
        ],
        workingDir: runtimeDir,
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
      reportProgress("complete", 3, 3, "Hugo build complete");
      return { success: true, message: "Hugo build complete" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to execute Hugo: ${errorMessage}`
      };
    } finally {
      await cleanupRuntime(runtimeDir);
    }
  }
  var HugoGenerator = { on_build };
  window.HugoGenerator = HugoGenerator;
  var main_default = HugoGenerator;
  return __toCommonJS(main_exports);
})();
