/**
 * Email Newsletter Plugin
 *
 * Syndicates articles to email subscribers via Buttondown after deployment.
 */

import type { AfterDeployContext, HookResult, ArticleInfo } from "./types";
import type { PluginConfig, SyndicatedEntry } from "./types";
import { showToast, openBrowser } from "@symbiosis-lab/moss-api";
import { createEmail } from "./buttondown";
import {
  loadSyndicationData,
  saveSyndicationData,
  isAlreadySyndicated,
  recordSyndication,
} from "./tracking";

/**
 * Convert article content to email-friendly format
 *
 * Buttondown supports Markdown, so we can use the article content directly.
 * We add a canonical link at the bottom pointing to the original article.
 */
function formatEmailBody(article: ArticleInfo, siteUrl: string): string {
  const canonicalUrl = `${siteUrl.replace(/\/$/, "")}/${article.url_path.replace(/^\//, "").replace(/\.html$/, "")}`;

  // Article content is already Markdown
  let body = article.content;

  // Add canonical link footer
  body += `\n\n---\n\n*Originally published at [${canonicalUrl}](${canonicalUrl})*`;

  return body;
}

/**
 * syndicate hook - Send articles to email subscribers via Buttondown
 *
 * This capability publishes content to email after deployment.
 * Only syndicates articles that haven't been sent before.
 */
export async function syndicate(context: AfterDeployContext): Promise<HookResult> {
  console.log("📧 Email Newsletter: Starting syndication...");

  try {
    const config = context.config as PluginConfig;

    // Validate API key
    if (!config.api_key) {
      console.warn("⚠️ No Buttondown API key configured");
      await showToast({
        message: "Email newsletter: No API key configured",
        variant: "warning",
        duration: 5000,
      });
      return {
        success: false,
        message: "No Buttondown API key configured. Add api_key to plugin config.",
      };
    }

    if (!context.deployment) {
      return {
        success: false,
        message: "No deployment information available",
      };
    }

    const { url: siteUrl } = context.deployment;
    const { articles } = context;

    // Load syndication tracking data
    const syndicationData = await loadSyndicationData();

    // Filter to only articles that haven't been syndicated yet
    const articlesToSyndicate = articles.filter((article) => {
      return !isAlreadySyndicated(syndicationData, article.url_path);
    });

    if (articlesToSyndicate.length === 0) {
      console.log("ℹ️ No new articles to syndicate to email");
      return {
        success: true,
        message: "No new articles to syndicate",
      };
    }

    console.log(`📧 Syndicating ${articlesToSyndicate.length} article(s) to Buttondown`);
    console.log(`🌐 Site URL: ${siteUrl}`);
    console.log(`📝 Mode: Draft`);

    await showToast({
      message: `Creating ${articlesToSyndicate.length} draft(s) for newsletter...`,
      variant: "info",
      duration: 3000,
    });

    // Syndicate articles one at a time
    let drafts = 0;
    const errors: string[] = [];

    for (const article of articlesToSyndicate) {
      try {
        console.log(`  → Syndicating: ${article.title}`);

        const emailBody = formatEmailBody(article, siteUrl);
        const response = await createEmail(
          config.api_key,
          article.title,
          emailBody,
          true // Always create drafts
        );

        // Record successful syndication
        const entry: SyndicatedEntry = {
          url_path: article.url_path,
          syndicated_at: new Date().toISOString(),
          email_id: response.id,
          status: "draft",
        };
        recordSyndication(syndicationData, entry);

        // Save after each article to avoid losing data on error
        await saveSyndicationData(syndicationData);

        drafts++;
        console.log(`    📝 Draft created: ${article.title}`);
      } catch (error) {
        console.error(`    ✗ Failed to syndicate ${article.title}:`, error);
        errors.push(`${article.title}: ${error}`);
      }
    }

    // Build summary
    const parts: string[] = [];
    if (drafts > 0) parts.push(`${drafts} drafts`);
    if (errors.length > 0) parts.push(`${errors.length} failed`);

    const summary = parts.join(", ");

    if (errors.length > 0) {
      console.warn(`⚠️ Email syndication complete: ${summary}`);
      await showToast({
        message: `Newsletter: ${summary}`,
        variant: "warning",
        duration: 5000,
      });
    } else {
      console.log(`✅ Email syndication complete: ${summary}`);
      await showToast({
        message: `Newsletter drafts created: ${drafts}`,
        variant: "success",
        duration: 5000,
      });
    }

    // Open browser to review drafts if any were created
    if (drafts > 0) {
      await openBrowser("https://buttondown.com/emails");
    }

    return {
      success: errors.length === 0,
      message: `Email syndication: ${summary}`,
    };
  } catch (error) {
    console.error("❌ Email Newsletter: Syndication failed:", error);
    await showToast({
      message: "Newsletter syndication failed",
      variant: "error",
      duration: 5000,
    });
    return {
      success: false,
      message: `Syndication failed: ${error}`,
    };
  }
}

// ============================================================================
// Plugin Export
// ============================================================================

import { enhance } from "./enhance";

/**
 * Plugin object exported as global for the moss plugin runtime
 */
const EmailNewsletter = {
  enhance,
  syndicate,
};

// Register plugin globally for the plugin runtime
(window as unknown as { EmailNewsletter: typeof EmailNewsletter }).EmailNewsletter =
  EmailNewsletter;

// Also export for module usage
export { enhance };
export { syndicate as after_deploy };
export default EmailNewsletter;
