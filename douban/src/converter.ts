/**
 * Content conversion for Douban.
 *
 * Douban data is structured (ratings, metadata, short reviews), not articles.
 * The converter extracts structured data from Douban HTML and produces
 * markdown files with rich frontmatter.
 */

/**
 * Parse the #info section of a Douban book page into structured fields.
 *
 * Douban's info section uses two patterns:
 * 1. <span class="pl">Label:</span> Value <br>
 * 2. <span><span class="pl"> Label</span>: <a>Value</a></span><br>
 */
export function parseBookInfo(infoHtml: string): Record<string, string> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(infoHtml, "text/html");
  const result: Record<string, string> = {};

  // Strategy 1: Find all <span class="pl"> labels and extract their sibling text
  const labels = doc.querySelectorAll("span.pl");
  for (const label of labels) {
    let key = label.textContent?.replace(/[:：]/g, "").trim() || "";
    if (!key) continue;

    // The value is the text/link after the label, before the next <br>
    // Walk siblings from the label's parent context
    const parent = label.parentElement;
    if (!parent) continue;

    // If parent is a <span> wrapping both label + link (pattern 2)
    if (parent.tagName === "SPAN" && parent !== doc.body) {
      const link = parent.querySelector("a");
      if (link) {
        result[key] = link.textContent?.trim() || "";
        continue;
      }
    }

    // Pattern 1: <span class="pl">Label:</span> Value <br>
    // Walk immediate siblings of the label to collect text until <br>
    let value = "";
    let node: Node | null = label.nextSibling;
    while (node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element;
        if (el.tagName === "BR") break;
        if (el.tagName === "A") {
          value += el.textContent || "";
        }
      } else if (node.nodeType === Node.TEXT_NODE) {
        value += node.textContent || "";
      }
      node = node.nextSibling;
    }
    value = value.replace(/^[:：\s]+/, "").trim();
    if (value) result[key] = value;
  }

  return result;
}

/**
 * Parse the intro section (book/movie description).
 */
export function parseIntro(introHtml: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(introHtml, "text/html");
  // Remove "展开全部" links
  doc.querySelectorAll(".a_show_full, .all").forEach((el) => el.remove());
  return doc.body.innerText.trim();
}

/**
 * Parse a user's star rating from a CSS class like "allstar40" → 4.
 */
export function parseStarRating(className: string): number {
  const match = className.match(/allstar(\d+)/);
  if (!match) return 0;
  return Math.round(parseInt(match[1], 10) / 10);
}

/**
 * Parse the user collection status from text like "2016-07-22\n      读过"
 */
export function parseCollectionDate(dateText: string): { date: string; status: string } {
  const cleaned = dateText.replace(/\s+/g, " ").trim();
  const dateMatch = cleaned.match(/(\d{4}-\d{2}-\d{2})/);
  const date = dateMatch ? dateMatch[1] : "";

  let status = "done";
  if (cleaned.includes("在读") || cleaned.includes("在看")) {
    status = "doing";
  } else if (cleaned.includes("想读") || cleaned.includes("想看")) {
    status = "wish";
  }

  return { date, status };
}

/**
 * Generate YAML frontmatter for a Douban review/rating.
 */
export function generateFrontmatter(meta: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${item}`);
      }
    } else if (typeof value === "string" && (value.includes(":") || value.includes("#"))) {
      lines.push(`${key}: "${value}"`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("---");
  return lines.join("\n") + "\n";
}

/**
 * Convert a Douban collection item to a markdown file with frontmatter.
 */
export function itemToMarkdown(
  item: { title: string; rating: number; date: string; status: string; comment: string; url: string; mediaType: string; tags?: string[] },
  detail?: { author?: string; intro?: string; coverImage?: string; publisher?: string; publishDate?: string; isbn?: string }
): string {
  const fm = generateFrontmatter({
    title: item.title,
    type: "review",
    media_type: item.mediaType,
    rating: item.rating,
    date_consumed: item.date,
    status: item.status,
    douban_url: item.url,
    ...(item.tags && item.tags.length > 0 ? { tags: item.tags } : {}),
    ...(detail?.author ? { author: detail.author } : {}),
    ...(detail?.publisher ? { publisher: detail.publisher } : {}),
    ...(detail?.publishDate ? { publish_date: detail.publishDate } : {}),
    ...(detail?.isbn ? { isbn: detail.isbn } : {}),
    ...(detail?.coverImage ? { cover: detail.coverImage } : {}),
  });

  let body = "";
  if (item.comment) {
    body += item.comment + "\n";
  }
  if (detail?.intro) {
    body += "\n## About\n\n" + detail.intro + "\n";
  }

  return fm + "\n" + body;
}
