"use strict";
var EmailNewsletter = (() => {
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
    after_deploy: () => syndicate,
    default: () => main_default,
    enhance: () => enhance,
    syndicate: () => syndicate
  });

  // node_modules/@symbiosis-lab/moss-api/dist/index.mjs
  function getTauriCore() {
    const w = window;
    if (!w.__TAURI__?.core) throw new Error("Tauri core not available");
    return w.__TAURI__.core;
  }
  function getTauriEvent$1() {
    const w = window;
    if (!w.__TAURI__?.event) throw new Error("Tauri event API not available");
    return w.__TAURI__.event;
  }
  async function emitEvent(event, payload) {
    await getTauriEvent$1().emit(event, payload);
  }
  function getTauriEvent() {
    const w = window;
    if (!w.__TAURI__?.event?.listen) throw new Error("Tauri event API not available");
    return w.__TAURI__.event;
  }
  async function openBrowser(url) {
    await getTauriCore().invoke("open_plugin_browser", { url });
    const closed = new Promise((resolve) => {
      const { listen } = getTauriEvent();
      listen("browser-closed", (event) => {
        const payload = event.payload;
        resolve(payload.reason);
      }).then((unlisten) => {
        closed.then(() => unlisten());
      });
    });
    return { closed };
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
  async function httpPost(url, body, options = {}) {
    const { timeoutMs = 3e4, headers = {} } = options;
    const result = await getTauriCore().invoke("http_post", {
      url,
      body: JSON.stringify(body),
      headers,
      timeoutMs
    });
    const binaryString = atob(result.body_base64);
    const bytes = Uint8Array.from(binaryString, (char) => char.charCodeAt(0));
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
  async function httpGet(url, options = {}) {
    const { timeoutMs = 3e4, headers = {} } = options;
    const result = await getTauriCore().invoke("http_get", {
      url,
      headers,
      timeoutMs
    });
    const binaryString = atob(result.body_base64);
    const bytes = Uint8Array.from(binaryString, (char) => char.charCodeAt(0));
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
  var TOAST_EVENT = "plugin-toast";
  async function showToast(options) {
    await emitEvent(TOAST_EVENT, typeof options === "string" ? { message: options } : options);
  }

  // src/buttondown.ts
  var BUTTONDOWN_API_URL = "https://api.buttondown.com/v1/emails";
  var BUTTONDOWN_NEWSLETTERS_URL = "https://api.buttondown.com/v1/newsletters";
  async function createEmail(apiKey, subject, body, asDraft = true) {
    const status = asDraft ? "draft" : "sent";
    const result = await httpPost(
      BUTTONDOWN_API_URL,
      {
        subject,
        body,
        status
      },
      {
        headers: {
          Authorization: `Token ${apiKey}`
        }
      }
    );
    if (!result.ok) {
      const errorText = result.text();
      throw new Error(`Buttondown API error (${result.status}): ${errorText}`);
    }
    const response = JSON.parse(result.text());
    return response;
  }
  async function getNewsletterInfo(apiKey) {
    const result = await httpGet(BUTTONDOWN_NEWSLETTERS_URL, {
      headers: { Authorization: `Token ${apiKey}` }
    });
    if (!result.ok) {
      throw new Error(`Buttondown API error (${result.status}): ${result.text()}`);
    }
    const data = JSON.parse(result.text());
    const newsletter = Array.isArray(data.results) ? data.results[0] : data;
    if (!newsletter?.username) {
      throw new Error("No newsletter found for this API key");
    }
    return { username: newsletter.username };
  }

  // src/tracking.ts
  var TRACKING_FILE = "syndicated.json";
  async function loadSyndicationData() {
    try {
      if (await pluginFileExists(TRACKING_FILE)) {
        const content = await readPluginFile(TRACKING_FILE);
        return JSON.parse(content);
      }
    } catch (error) {
      console.warn(`Failed to load syndication data: ${error}`);
    }
    return { articles: {} };
  }
  async function saveSyndicationData(data) {
    await writePluginFile(TRACKING_FILE, JSON.stringify(data, null, 2));
  }
  function isAlreadySyndicated(data, urlPath) {
    return urlPath in data.articles;
  }
  function recordSyndication(data, entry) {
    data.articles[entry.url_path] = entry;
  }

  // src/enhance.ts
  async function enhance(ctx) {
    const config = ctx.config;
    if (!config.api_key) {
      console.warn(
        "No Buttondown API key configured, skipping footer injection"
      );
      return { success: false, message: "No API key configured" };
    }
    let username;
    try {
      if (await pluginFileExists("newsletter-info.json")) {
        const cached = JSON.parse(await readPluginFile("newsletter-info.json"));
        username = cached.username;
      } else {
        const info = await getNewsletterInfo(config.api_key);
        username = info.username;
        await writePluginFile(
          "newsletter-info.json",
          JSON.stringify({ username })
        );
      }
    } catch (e) {
      return { success: false, message: `Failed to get newsletter info: ${e}` };
    }
    const files = await listFiles();
    const htmlFiles = files.filter((f) => f.endsWith(".html"));
    for (const filePath of htmlFiles) {
      try {
        const html = await readFile(filePath);
        const modified = injectSubscribeForm(html, username);
        if (modified !== html) {
          await writeFile(filePath, modified);
        }
      } catch (e) {
        console.warn(`Failed to process ${filePath}: ${e}`);
      }
    }
    return { success: true };
  }
  function injectSubscribeForm(html, username) {
    const footerContentRegex = /<div class="footer-content">([\s\S]*?)<\/div>/;
    const match = html.match(footerContentRegex);
    if (!match) return html;
    const formHtml = `<div class="footer-content">
    <a href="/feed.xml" class="footer-link" data-external>RSS</a>
    <form action="https://buttondown.com/api/emails/embed-subscribe/${username}" method="post" class="footer-subscribe-form">
        <input type="email" name="email" placeholder="your@email.com" required />
        <input type="hidden" value="1" name="embed" />
        <button type="submit">Subscribe</button>
    </form>
</div>`;
    return html.replace(footerContentRegex, formHtml);
  }

  // src/main.ts
  function formatEmailBody(article, siteUrl) {
    const canonicalUrl = `${siteUrl.replace(/\/$/, "")}/${article.url_path.replace(/^\//, "").replace(/\.html$/, "")}`;
    let body = article.content;
    body += `

---

*Originally published at [${canonicalUrl}](${canonicalUrl})*`;
    return body;
  }
  async function syndicate(context) {
    console.log("\u{1F4E7} Email Newsletter: Starting syndication...");
    try {
      const config = context.config;
      if (!config.api_key) {
        console.warn("\u26A0\uFE0F No Buttondown API key configured");
        await showToast({
          message: "Email newsletter: No API key configured",
          variant: "warning",
          duration: 5e3
        });
        return {
          success: false,
          message: "No Buttondown API key configured. Add api_key to plugin config."
        };
      }
      if (!context.deployment) {
        return {
          success: false,
          message: "No deployment information available"
        };
      }
      const { url: siteUrl } = context.deployment;
      const { articles } = context;
      const syndicationData = await loadSyndicationData();
      const articlesToSyndicate = articles.filter((article) => {
        return !isAlreadySyndicated(syndicationData, article.url_path);
      });
      if (articlesToSyndicate.length === 0) {
        console.log("\u2139\uFE0F No new articles to syndicate to email");
        return {
          success: true,
          message: "No new articles to syndicate"
        };
      }
      console.log(`\u{1F4E7} Syndicating ${articlesToSyndicate.length} article(s) to Buttondown`);
      console.log(`\u{1F310} Site URL: ${siteUrl}`);
      console.log(`\u{1F4DD} Mode: Draft`);
      await showToast({
        message: `Creating ${articlesToSyndicate.length} draft(s) for newsletter...`,
        variant: "info",
        duration: 3e3
      });
      let drafts = 0;
      const errors = [];
      for (const article of articlesToSyndicate) {
        try {
          console.log(`  \u2192 Syndicating: ${article.title}`);
          const emailBody = formatEmailBody(article, siteUrl);
          const response = await createEmail(
            config.api_key,
            article.title,
            emailBody,
            true
            // Always create drafts
          );
          const entry = {
            url_path: article.url_path,
            syndicated_at: (/* @__PURE__ */ new Date()).toISOString(),
            email_id: response.id,
            status: "draft"
          };
          recordSyndication(syndicationData, entry);
          await saveSyndicationData(syndicationData);
          drafts++;
          console.log(`    \u{1F4DD} Draft created: ${article.title}`);
        } catch (error) {
          console.error(`    \u2717 Failed to syndicate ${article.title}:`, error);
          errors.push(`${article.title}: ${error}`);
        }
      }
      const parts = [];
      if (drafts > 0) parts.push(`${drafts} drafts`);
      if (errors.length > 0) parts.push(`${errors.length} failed`);
      const summary = parts.join(", ");
      if (errors.length > 0) {
        console.warn(`\u26A0\uFE0F Email syndication complete: ${summary}`);
        await showToast({
          message: `Newsletter: ${summary}`,
          variant: "warning",
          duration: 5e3
        });
      } else {
        console.log(`\u2705 Email syndication complete: ${summary}`);
        await showToast({
          message: `Newsletter drafts created: ${drafts}`,
          variant: "success",
          duration: 5e3
        });
      }
      if (drafts > 0) {
        await openBrowser("https://buttondown.com/emails");
      }
      return {
        success: errors.length === 0,
        message: `Email syndication: ${summary}`
      };
    } catch (error) {
      console.error("\u274C Email Newsletter: Syndication failed:", error);
      await showToast({
        message: "Newsletter syndication failed",
        variant: "error",
        duration: 5e3
      });
      return {
        success: false,
        message: `Syndication failed: ${error}`
      };
    }
  }
  var EmailNewsletter = {
    enhance,
    syndicate
  };
  window.EmailNewsletter = EmailNewsletter;
  var main_default = EmailNewsletter;
  return __toCommonJS(main_exports);
})();
