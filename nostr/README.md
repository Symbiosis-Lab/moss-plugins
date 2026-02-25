# Nostr Plugin for moss

Social interactions via the Nostr protocol - comments, likes, zaps, and article syndication.

## Overview

This plugin enables moss-generated static sites to:

1. **Fetch interactions** from Nostr relays (comments, likes, zaps)
2. **Render interactions** into generated HTML pages with progressive enhancement
3. **Publish articles** to Nostr as NIP-23 long-form content

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         moss Build Pipeline                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────────┐    │
│  │ process hook │ ──▶ │ generate     │ ──▶ │ enhance hook     │    │
│  │              │     │ (HTML)       │     │                  │    │
│  │ Fetch from   │     │              │     │ Inject islands   │    │
│  │ relays       │     │ Preview      │     │ into HTML        │    │
│  └──────────────┘     │ available    │     └──────────────────┘    │
│         │             └──────────────┘              │               │
│         │                                           │               │
│         ▼                                           ▼               │
│  ┌──────────────┐                          ┌──────────────────┐    │
│  │ Interaction[]│ ────────────────────────▶│ Enriched HTML    │    │
│  │ (aggregated) │                          │ + Browser JS/CSS │    │
│  └──────────────┘                          └──────────────────┘    │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    syndicate hook                             │  │
│  │  Publish articles as NIP-23 long-form content to relays       │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Installation

1. Copy the plugin to your moss project:
   ```bash
   cp -r nostr/ your-project/.moss/plugins/nostr/
   ```

2. Configure the plugin in your project's `moss.yaml`:
   ```yaml
   plugins:
     nostr:
       relays:
         - wss://relay.damus.io
         - wss://nos.lol
         - wss://relay.nostr.band
       pubkey: "npub1..." # Your Nostr public key (optional, for filtering)
       nsec: "nsec1..."   # Private key for publishing (optional)
   ```

## Configuration

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `relays` | `string[]` | Yes | List of Nostr relay WebSocket URLs |
| `pubkey` | `string` | No | Your npub for filtering interactions |
| `nsec` | `string` | No | Your nsec for signing published articles |
| `site_url` | `string` | No | Base URL for your site (used in queries) |

## Plugin Hooks

### Process Hook

Fetches social interactions from configured Nostr relays.

**Input:** `ProcessContext` with project info and config
**Output:** `HookResult` with `interactions[]` array

**Supported event kinds:**
- `kind:1` - Short text notes (comments)
- `kind:7` - Reactions (likes)
- `kind:9735` - Zap receipts

**Example output:**
```typescript
{
  success: true,
  message: "Fetched 15 interactions from 3 relay(s)",
  interactions: [
    {
      id: "abc123...",
      source: "nostr",
      interaction_type: "comment",
      author: {
        name: "npub1abc...",
        identifier: "npub1abcdef..."
      },
      content: "Great article!",
      published_at: "2024-01-15T10:30:00.000Z",
      source_url: "https://njump.me/note1...",
      target_url: "posts/my-article.html"
    }
  ]
}
```

### Enhance Hook

Injects interaction islands into generated HTML pages.

**Input:** `EnhanceContext` with aggregated interactions from all plugins
**Output:** Modified HTML files with embedded interaction UI

**Features:**
- Groups interactions by target URL
- Injects interactive section before `</article>` tag
- Embeds interaction data as JSON for browser hydration
- Provides `<noscript>` fallback for non-JS browsers
- Copies browser assets (JS/CSS) to output directory

**Injected HTML structure:**
```html
<section id="nostr-interactions" class="social-interactions">
  <script type="application/json" id="interactions-data">
    {"interactions": [...], "config": {...}}
  </script>
  <noscript>
    <div class="interactions-static">
      <h3>Responses (5)</h3>
      <p>👏 3 likes</p>
      <ul class="comments-list">...</ul>
    </div>
  </noscript>
</section>

<!-- Async loader before </body> -->
<script>
(function() {
  if (!document.getElementById('nostr-interactions')) return;
  var s = document.createElement('script');
  s.src = '/js/nostr-social.js';
  s.async = true;
  document.body.appendChild(s);
})();
</script>
```

### Syndicate Hook

Publishes articles to Nostr as NIP-23 long-form content.

**Input:** `SyndicateContext` with articles to publish
**Output:** `HookResult` with publish status

**Requirements:**
- `nsec` must be configured (NIP-19 format)
- At least one relay must be configured

**NIP-23 event structure:**
```json
{
  "kind": 30023,
  "pubkey": "<derived from nsec>",
  "content": "<article markdown/text>",
  "tags": [
    ["d", "<slug-from-url>"],
    ["title", "Article Title"],
    ["published_at", "<unix timestamp>"],
    ["t", "tag1"],
    ["t", "tag2"]
  ]
}
```

## Browser Component

The browser JavaScript (`nostr-social.js`) provides:

- **Hydration** of server-rendered interaction data
- **Real-time updates** from Nostr relays
- **NIP-07 integration** for browser extension login
- **Reply/zap UI** for logged-in users (placeholder)
- **Dark mode** support

### Customization

Override styles by targeting these CSS classes:
```css
.social-interactions { }
.interactions-header { }
.interaction-item { }
.interaction-author { }
.interaction-content { }
.interaction-meta { }
.source-badge { }
```

## Development

### Prerequisites

- Node.js 18+
- npm 9+

### Setup

```bash
cd nostr
npm install
```

### Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Build plugin and browser assets |
| `npm run dev` | Watch mode for development |
| `npm test` | Run unit tests |
| `npm run test:watch` | Run tests in watch mode |

### Project Structure

```
nostr/
├── assets/
│   └── manifest.json       # Plugin manifest
├── browser/
│   ├── nostr-social.ts     # Browser hydration script
│   └── nostr-social.css    # Interaction styles
├── dist/                   # Built output
├── features/               # Cucumber/BDD feature files
│   ├── process/
│   ├── enhance/
│   ├── syndicate/
│   └── steps/              # Step definitions
├── src/
│   ├── main.ts             # Plugin entry point
│   ├── relay.ts            # Nostr relay communication
│   ├── types.ts            # TypeScript type definitions
│   └── __tests__/          # Unit tests
├── test-helpers/
│   ├── mock-relay.ts       # Mock relay for testing
│   └── test-utils.ts       # Test utilities
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### Testing

Unit tests cover:
- Process hook behavior (relay fetching, error handling)
- Enhance hook behavior (HTML injection, XSS prevention)
- Interaction grouping and formatting

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage
```

## Nostr Protocol References

- [NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md) - Basic protocol
- [NIP-07](https://github.com/nostr-protocol/nips/blob/master/07.md) - Browser extension
- [NIP-19](https://github.com/nostr-protocol/nips/blob/master/19.md) - bech32 encoding (npub, nsec, note)
- [NIP-23](https://github.com/nostr-protocol/nips/blob/master/23.md) - Long-form content
- [NIP-57](https://github.com/nostr-protocol/nips/blob/master/57.md) - Zaps

## Security Considerations

1. **Private keys**: Never commit `nsec` keys to version control. Use environment variables or secure secret management.

2. **XSS prevention**: All user-generated content is HTML-escaped before rendering in the static fallback.

3. **Content validation**: The browser component sanitizes interaction content before DOM insertion.

## License

MIT
