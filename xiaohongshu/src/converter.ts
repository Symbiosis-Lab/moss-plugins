/**
 * Content conversion: Xiaohongshu note HTML -> Markdown.
 *
 * Xiaohongshu note HTML contains:
 * - Paragraphs of text (often in <p> or <span> tags)
 * - Image references (<img> tags or data attributes)
 * - Hashtags as clickable <a> tags with #topic text
 *
 * Notes are image-first, so the converter preserves images prominently
 * and extracts hashtags from the text.
 *
 * Image emission convention (unified-image-emission Decision #9):
 * Always emit canonical `![alt](src)` markdown. Never emit raw <img>.
 * moss treats author-typed HTML as opaque (no LQIP/dims/loading injection);
 * raw <img> from a plugin would silently lose all enhancement and break
 * image-pipeline invariants (variant registration, asset publish).
 */

/**
 * Convert Xiaohongshu note HTML to Markdown.
 */
export function htmlToMarkdown(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // Extract hashtags before processing (they appear as links or spans)
  const tags = extractHashtags(doc);

  return processNode(doc.body).trim() + "\n";
}

/**
 * Extract hashtag topics from Xiaohongshu note HTML.
 * Tags appear as <a> elements with href containing /page/topics/ or
 * as <span> elements with class "tag" containing #text.
 */
export function extractHashtags(doc: Document): string[] {
  const tags: string[] = [];

  // Tags as links: <a href="/page/topics/...">topic</a>
  doc.querySelectorAll('a[href*="/page/topics/"]').forEach((el) => {
    const text = el.textContent?.replace(/^#\s*/, "").trim();
    if (text && !tags.includes(text)) {
      tags.push(text);
    }
  });

  // Tags as spans or data attributes
  doc.querySelectorAll("[data-type='hashtag'], .tag, .hashtag").forEach((el) => {
    const text = el.textContent?.replace(/^#\s*/, "").trim();
    if (text && !tags.includes(text)) {
      tags.push(text);
    }
  });

  // Fallback: extract #topic patterns from text content
  const textContent = doc.body.textContent || "";
  const hashtagMatches = textContent.match(/#[\u4e00-\u9fff\w]+/g);
  if (hashtagMatches) {
    for (const match of hashtagMatches) {
      const text = match.replace(/^#/, "").trim();
      if (text && !tags.includes(text)) {
        tags.push(text);
      }
    }
  }

  return tags;
}

function processNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || "";
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }

  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  const children = Array.from(el.childNodes).map(processNode).join("");

  switch (tag) {
    case "h1":
      return `# ${children.trim()}\n\n`;
    case "h2":
      return `## ${children.trim()}\n\n`;
    case "h3":
      return `### ${children.trim()}\n\n`;
    case "p":
      return `${children.trim()}\n\n`;
    case "br":
      return "\n";
    case "strong":
    case "b":
      return `**${children}**`;
    case "em":
    case "i":
      return `*${children}*`;
    case "a": {
      const href = el.getAttribute("href") || "";
      // Hashtag links — render as plain text with hash
      if (href.includes("/page/topics/") || href.includes("/search_result/")) {
        return children;
      }
      if (!href || href === children.trim()) {
        return children;
      }
      return `[${children}](${href})`;
    }
    case "img": {
      const src = el.getAttribute("src") || el.getAttribute("data-src") || "";
      const alt = el.getAttribute("alt") || "";
      if (!src) return "";
      return `![${alt}](${src})\n\n`;
    }
    case "figure": {
      const img = el.querySelector("img");
      const caption = el.querySelector("figcaption");
      if (img) {
        const src = img.getAttribute("src") || img.getAttribute("data-src") || "";
        const alt = img.getAttribute("alt") || caption?.textContent || "";
        return `![${alt}](${src})\n\n`;
      }
      return children;
    }
    case "div":
    case "span":
    case "section":
    case "article":
    case "main":
      return children;
    case "hr":
      return "---\n\n";
    case "ul":
      return children + "\n";
    case "ol":
      return children + "\n";
    case "li": {
      const parent = el.parentElement?.tagName.toLowerCase();
      const siblings = Array.from(el.parentElement?.children || []);
      const index = siblings.indexOf(el);
      const prefix = parent === "ol" ? `${index + 1}. ` : "- ";
      return `${prefix}${children.trim()}\n`;
    }
    case "blockquote":
      return (
        children
          .trim()
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n") + "\n\n"
      );
    default:
      return children;
  }
}

/**
 * Generate YAML frontmatter from note metadata.
 */
export function generateFrontmatter(meta: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${item}`);
      }
    } else if (typeof value === "string" && value.includes(":")) {
      lines.push(`${key}: "${value}"`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("---");
  return lines.join("\n") + "\n";
}

/**
 * Parse YAML frontmatter from a markdown file.
 * Returns the frontmatter data and the body content.
 */
export function parseFrontmatter(content: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const frontmatter: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, "");
    frontmatter[key] = value;
  }

  return { frontmatter, body: match[2] };
}
