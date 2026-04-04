/**
 * Content conversion: X article HTML <-> Markdown.
 *
 * X articles use standard semantic HTML:
 * p, h1, h2, h3, h4, strong, em, code, ul, ol, li, blockquote, a, img
 */

/**
 * Convert X article HTML to Markdown.
 */
export function htmlToMarkdown(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  return processNode(doc.body).trim() + "\n";
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
    case "strong":
    case "b":
      return `**${children}**`;
    case "em":
    case "i":
      return `*${children}*`;
    case "s":
    case "del":
    case "strike":
      return `~~${children}~~`;
    case "code": {
      // Check if parent is <pre> (code block)
      if (el.parentElement?.tagName.toLowerCase() === "pre") {
        return children;
      }
      return `\`${children}\``;
    }
    case "pre": {
      const codeEl = el.querySelector("code");
      const lang = codeEl?.className?.match(/language-(\w+)/)?.[1] || "";
      const codeText = codeEl?.textContent || children;
      return `\`\`\`${lang}\n${codeText.trim()}\n\`\`\`\n\n`;
    }
    case "blockquote":
      return (
        children
          .trim()
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n") + "\n\n"
      );
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
    case "a": {
      const href = el.getAttribute("href") || "";
      if (!href || href === children.trim()) {
        return children;
      }
      return `[${children}](${href})`;
    }
    case "img": {
      const src = el.getAttribute("src") || "";
      const alt = el.getAttribute("alt") || "";
      return `![${alt}](${src})\n\n`;
    }
    case "figure": {
      // Figure may contain img + figcaption
      const img = el.querySelector("img");
      const caption = el.querySelector("figcaption");
      if (img) {
        const src = img.getAttribute("src") || "";
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
    default:
      return children;
  }
}

/**
 * Convert Markdown to HTML suitable for X's article editor.
 * This is a simple conversion — the editor will reformat as needed.
 */
export function markdownToHtml(md: string): string {
  let html = md;

  // Headings (must be done before inline patterns)
  html = html.replace(/^#### (.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

  // Horizontal rule
  html = html.replace(/^---$/gm, "<hr>");

  // Images
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Bold + italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Strikethrough
  html = html.replace(/~~(.+?)~~/g, "<s>$1</s>");

  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Code blocks (before paragraphs)
  html = html.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_, lang, code) => `<pre><code class="language-${lang}">${code.trim()}</code></pre>`
  );

  // Blockquotes
  html = html.replace(
    /(?:^> .+\n?)+/gm,
    (match) => {
      const inner = match.replace(/^> ?/gm, "").trim();
      return `<blockquote><p>${inner.replace(/\n\n/g, "</p><p>")}</p></blockquote>`;
    }
  );

  // Unordered lists
  html = html.replace(
    /(?:^- .+\n?)+/gm,
    (match) => {
      const items = match
        .split("\n")
        .filter((l) => l.startsWith("- "))
        .map((l) => `<li>${l.slice(2)}</li>`)
        .join("");
      return `<ul>${items}</ul>`;
    }
  );

  // Ordered lists
  html = html.replace(
    /(?:^\d+\. .+\n?)+/gm,
    (match) => {
      const items = match
        .split("\n")
        .filter((l) => /^\d+\. /.test(l))
        .map((l) => `<li>${l.replace(/^\d+\. /, "")}</li>`)
        .join("");
      return `<ol>${items}</ol>`;
    }
  );

  // Paragraphs: lines that aren't already wrapped in tags
  html = html
    .split("\n\n")
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      if (/^<(?:h[1-6]|ul|ol|blockquote|pre|hr|img|figure|div)/.test(trimmed)) {
        return trimmed;
      }
      return `<p>${trimmed}</p>`;
    })
    .join("\n");

  return html;
}

/**
 * Generate YAML frontmatter from article metadata.
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
