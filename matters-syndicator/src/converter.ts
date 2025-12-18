/**
 * Content conversion utilities: HTML to Markdown and frontmatter handling
 */

import type { FrontmatterData, ParsedFrontmatter } from "./types";

// ============================================================================
// HTML to Markdown Conversion
// ============================================================================

/**
 * Convert HTML content to Markdown
 */
export function htmlToMarkdown(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  return processNode(doc.body);
}

/**
 * Process a DOM node and convert to Markdown
 */
function processNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || "";
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }

  const element = node as Element;
  const tagName = element.tagName.toLowerCase();
  const children = Array.from(element.childNodes).map(processNode).join("");

  switch (tagName) {
    case "h1":
      return `# ${children.trim()}\n\n`;
    case "h2":
      return `## ${children.trim()}\n\n`;
    case "h3":
      return `### ${children.trim()}\n\n`;
    case "h4":
      return `#### ${children.trim()}\n\n`;
    case "h5":
      return `##### ${children.trim()}\n\n`;
    case "h6":
      return `###### ${children.trim()}\n\n`;
    case "p":
      return `${children.trim()}\n\n`;
    case "br":
      return "\n";
    case "hr":
      return "\n---\n\n";
    case "strong":
    case "b":
      return children.trim() ? `**${children}**` : "";
    case "em":
    case "i":
      return `*${children}*`;
    case "code":
      if (element.parentElement?.tagName.toLowerCase() === "pre") {
        return children;
      }
      return `\`${children}\``;
    case "pre": {
      const codeElement = element.querySelector("code");
      const codeContent = codeElement ? codeElement.textContent : children;
      const lang = codeElement?.className?.match(/language-(\w+)/)?.[1] || "";
      return `\n\`\`\`${lang}\n${codeContent?.trim()}\n\`\`\`\n\n`;
    }
    case "a": {
      const href = element.getAttribute("href") || "";
      return `[${children}](${href})`;
    }
    case "img": {
      const src = element.getAttribute("src") || "";
      const alt = element.getAttribute("alt") || "";
      return `![${alt}](${src})`;
    }
    case "ul":
      return "\n" + children + "\n";
    case "ol":
      return "\n" + children + "\n";
    case "li": {
      const parent = element.parentElement;
      if (parent?.tagName.toLowerCase() === "ol") {
        const index = Array.from(parent.children).indexOf(element) + 1;
        return `${index}. ${children.trim()}\n`;
      }
      return `- ${children.trim()}\n`;
    }
    case "blockquote": {
      const lines = children.trim().split("\n");
      return lines.map((line) => `> ${line}`).join("\n") + "\n\n";
    }
    case "figure":
      return children;
    case "figcaption":
      return children.trim() ? `*${children.trim()}*\n\n` : "";
    case "div":
    case "span":
    case "section":
    case "article":
      return children;
    default:
      return children;
  }
}

// ============================================================================
// Frontmatter Handling
// ============================================================================

/**
 * Generate frontmatter YAML from data object
 */
export function generateFrontmatter(data: FrontmatterData): string {
  const lines: string[] = ["---"];

  lines.push(`title: "${data.title.replace(/"/g, '\\"')}"`);

  if (data.is_collection) {
    lines.push("is_collection: true");
  }

  if (data.description) {
    lines.push(`description: "${data.description.replace(/"/g, '\\"')}"`);
  }

  if (data.date) {
    lines.push(`date: "${data.date}"`);
  }
  if (data.updated) {
    lines.push(`updated: "${data.updated}"`);
  }

  if (data.tags && data.tags.length > 0) {
    lines.push("tags:");
    for (const tag of data.tags) {
      lines.push(`  - "${tag.replace(/"/g, '\\"')}"`);
    }
  }

  if (data.cover) {
    lines.push(`cover: "${data.cover}"`);
  }

  if (data.syndicated && data.syndicated.length > 0) {
    lines.push("syndicated:");
    for (const url of data.syndicated) {
      lines.push(`  - "${url}"`);
    }
  }

  if (data.collections) {
    if (Array.isArray(data.collections)) {
      // Array format: collections as list of slugs
      if (data.collections.length > 0) {
        lines.push("collections:");
        for (const slug of data.collections) {
          lines.push(`  - "${slug}"`);
        }
      }
    } else if (Object.keys(data.collections).length > 0) {
      // Object format: collections with order numbers
      lines.push("collections:");
      for (const [slug, order] of Object.entries(data.collections)) {
        lines.push(`  ${slug}: ${order}`);
      }
    }
  }

  if (data.order && data.order.length > 0) {
    lines.push("order:");
    for (const filename of data.order) {
      lines.push(`  - "${filename}"`);
    }
  }

  lines.push("---");

  return lines.join("\n");
}

/**
 * Parse frontmatter from markdown content
 */
export function parseFrontmatter(content: string): ParsedFrontmatter | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return null;
  }

  const frontmatterStr = match[1];
  const body = match[2];

  const frontmatter: Record<string, unknown> = {};
  const lines = frontmatterStr.split("\n");
  let currentKey = "";
  let currentArray: string[] = [];

  for (const line of lines) {
    if (line.startsWith("  - ")) {
      const value = line.substring(4).replace(/^"(.*)"$/, "$1");
      currentArray.push(value);
    } else if (line.includes(":")) {
      // Save previous array if any
      if (currentKey && currentArray.length > 0) {
        frontmatter[currentKey] = currentArray;
        currentArray = [];
      }

      const colonIndex = line.indexOf(":");
      const key = line.substring(0, colonIndex);
      const rest = line.substring(colonIndex + 1).trim();

      if (rest === "") {
        // Array or object key (e.g., "tags:")
        currentKey = key;
        currentArray = [];
      } else {
        // Simple key-value pair
        currentKey = "";
        frontmatter[key] = rest.replace(/^"(.*)"$/, "$1");
      }
    }
  }

  // Save last array if any
  if (currentKey && currentArray.length > 0) {
    frontmatter[currentKey] = currentArray;
  }

  return { frontmatter, body };
}

/**
 * Regenerate frontmatter YAML from parsed object
 */
export function regenerateFrontmatter(frontmatter: Record<string, unknown>): string {
  const lines: string[] = ["---"];

  const formatValue = (value: unknown): string => {
    if (typeof value === "string") {
      if (value.includes(":") || value.includes("#") || value.includes('"') || value.startsWith(" ")) {
        return `"${value.replace(/"/g, '\\"')}"`;
      }
      return `"${value}"`;
    }
    return String(value);
  };

  const fieldOrder = ["title", "is_collection", "description", "date", "updated", "tags", "cover", "syndicated", "collections", "order"];

  for (const key of fieldOrder) {
    if (!(key in frontmatter)) continue;
    const value = frontmatter[key];

    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${formatValue(item)}`);
      }
    } else if (typeof value === "object" && value !== null) {
      lines.push(`${key}:`);
      for (const [subKey, subValue] of Object.entries(value)) {
        lines.push(`  ${subKey}: ${subValue}`);
      }
    } else if (typeof value === "boolean") {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: ${formatValue(value)}`);
    }
  }

  for (const [key, value] of Object.entries(frontmatter)) {
    if (fieldOrder.includes(key)) continue;

    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${formatValue(item)}`);
      }
    } else if (typeof value === "object" && value !== null) {
      lines.push(`${key}:`);
      for (const [subKey, subValue] of Object.entries(value)) {
        lines.push(`  ${subKey}: ${subValue}`);
      }
    } else if (typeof value === "boolean") {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: ${formatValue(value)}`);
    }
  }

  lines.push("---");
  return lines.join("\n");
}

/**
 * Extract all markdown links from content (not images)
 * Used for detecting internal Matters links that need rewriting
 */
export function extractMarkdownLinks(content: string): Array<{
  url: string;
  fullMatch: string;
}> {
  const results: Array<{ url: string; fullMatch: string }> = [];
  // Match markdown links [text](url) but NOT images ![alt](url)
  // Negative lookbehind (?<!!") ensures we don't match image syntax
  const linkPattern = /(?<!!)\[([^\]]*)\]\(([^)]+)\)/g;
  let match;

  while ((match = linkPattern.exec(content)) !== null) {
    results.push({
      fullMatch: match[0],
      url: match[2].trim(),
    });
  }

  return results;
}

/**
 * Extract remote image URLs from markdown content
 */
export function extractRemoteImageUrls(
  content: string
): Array<{ url: string; localFilename: string }> {
  const results: Array<{ url: string; localFilename: string }> = [];
  const seen = new Set<string>();

  const imagePattern = /!\[[^\]]*\]\(([^)]+)\)/g;
  let match;

  while ((match = imagePattern.exec(content)) !== null) {
    const url = match[1].trim();

    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      continue;
    }

    if (seen.has(url)) {
      continue;
    }
    seen.add(url);

    const localFilename = generateLocalFilenameFromUrl(url);
    if (localFilename) {
      results.push({ url, localFilename });
    }
  }

  return results;
}

/**
 * Generate local filename from URL (duplicated here to avoid circular dependency)
 */
function generateLocalFilenameFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const cleanPath = pathname.replace(/\/public$/, "");
    const segments = cleanPath.split("/").filter((s) => s.length > 0);

    for (let i = segments.length - 1; i >= 0; i--) {
      const segment = segments[i];
      const extMatch = segment.match(/\.(\w+)$/);
      if (extMatch) {
        const ext = extMatch[1].toLowerCase();
        if (i > 0 && /^[a-f0-9-]{36}$/i.test(segments[i - 1])) {
          return `${segments[i - 1]}.${ext}`;
        }
        return segment;
      }
    }

    for (const segment of segments) {
      if (/^[a-f0-9-]{36}$/i.test(segment)) {
        return segment;
      }
    }

    // Simple hash fallback
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
      hash = ((hash << 5) - hash) + url.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  } catch {
    return null;
  }
}
