/**
 * Internationalization (i18n) for the comment plugin
 *
 * Provides:
 * - Translation table for EN, Simplified Chinese, Traditional Chinese
 * - Language detection from HTML `<html lang="...">` attribute
 */

// ============================================================================
// Types
// ============================================================================

export type Lang = "en" | "zh-hans" | "zh-hant";

export interface TranslationStrings {
  comment_count_zero: string;
  comment_count_one: string;
  comment_count_many: string;
  placeholder: string;
  name: string;
  email_optional: string;
  website_optional: string;
  reply: string;
  reply_action: string;
  replying_to: string;
  cancel: string;
  submitting: string;
  comment_submitted: string;
  network_error: string;
}

// ============================================================================
// Translation Table
// ============================================================================

export const translations: Record<Lang, TranslationStrings> = {
  en: {
    comment_count_zero: "Comment",
    comment_count_one: "1 comment",
    comment_count_many: "{n} comments",
    placeholder: "Leave your thoughts",
    name: "Name",
    email_optional: "Email (optional)",
    website_optional: "Website (optional)",
    reply: "Reply",
    reply_action: "Reply",
    replying_to: "Replying to",
    cancel: "Cancel",
    submitting: "Submitting...",
    comment_submitted: "Comment submitted!",
    network_error: "Network error. Please try again.",
  },
  "zh-hans": {
    comment_count_zero: "评论",
    comment_count_one: "1条评论",
    comment_count_many: "{n}条评论",
    placeholder: "留下你的想法",
    name: "名字",
    email_optional: "邮箱（选填）",
    website_optional: "网站（选填）",
    reply: "回复",
    reply_action: "回复",
    replying_to: "回复",
    cancel: "取消",
    submitting: "提交中...",
    comment_submitted: "评论已提交！",
    network_error: "网络错误，请重试。",
  },
  "zh-hant": {
    comment_count_zero: "評論",
    comment_count_one: "1條評論",
    comment_count_many: "{n}條評論",
    placeholder: "留下你的想法",
    name: "名字",
    email_optional: "電子郵件（選填）",
    website_optional: "網站（選填）",
    reply: "回覆",
    reply_action: "回覆",
    replying_to: "回覆",
    cancel: "取消",
    submitting: "提交中...",
    comment_submitted: "評論已提交！",
    network_error: "網路錯誤，請重試。",
  },
};

// ============================================================================
// Language Detection
// ============================================================================

/**
 * Extract the lang attribute from an HTML string's `<html>` tag and map
 * it to a supported locale.
 *
 * Mapping:
 * - zh-hans, zh-cn -> zh-hans
 * - zh-hant, zh-tw -> zh-hant
 * - everything else -> en
 */
export function parseLang(html: string): Lang {
  // Match <html lang="..." or <html lang='...'
  const match = html.match(/<html[^>]*\slang=["']([^"']+)["']/i);
  if (!match) return "en";

  const raw = match[1].toLowerCase();

  if (raw === "zh-hans" || raw === "zh-cn") return "zh-hans";
  if (raw === "zh-hant" || raw === "zh-tw") return "zh-hant";

  return "en";
}

