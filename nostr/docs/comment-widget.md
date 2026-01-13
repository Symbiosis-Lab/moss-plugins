# Comment Widget Specification

**Status**: Implementation
**Purpose**: Drop-in comment widget for indie blogs with decentralized identity

---

## Overview

The comment widget enables readers to comment on any blog using the Moss Nostr plugin. It supports multiple identity tiers with graceful fallback, works across all major SSGs, and preserves scroll position during preview refreshes.

## Identity Resolution

The widget resolves identity in priority order:

```typescript
async function getSigner(): Promise<Signer> {
  // 1. NIP-07 browser extension (sovereign)
  if (window.nostr) {
    return new Nip07Signer();
  }

  // 2. NIP-46 remote signer connection (sovereign)
  const nip46 = localStorage.getItem('moss_nip46_connection');
  if (nip46 && await isRelayReachable(nip46)) {
    return new Nip46Signer(JSON.parse(nip46));
  }

  // 3. Host signer iframe (casual)
  const hostOrigin = localStorage.getItem('moss_signer_origin')
                     || 'https://signer.moss.host';
  if (await isOriginReachable(hostOrigin)) {
    return new IframeSigner(hostOrigin);
  }

  // 4. Local fallback (degraded)
  const localKey = await getLocalKey(); // blog's IndexedDB
  if (localKey) {
    return new LocalSigner(localKey, { showUpgradePrompt: true });
  }

  // 5. New user - generate local key
  return new LocalSigner(await generateKey(), {
    isNew: true,
    showSavePrompt: true
  });
}
```

## Signer Interface

All signers implement the same interface:

```typescript
interface Signer {
  /** Get the user's public key (npub) */
  getPublicKey(): Promise<string>;

  /** Sign a Nostr event */
  signEvent(event: UnsignedEvent): Promise<SignedEvent>;

  /** Check if signer is available/reachable */
  isAvailable(): Promise<boolean>;

  /** Get signer type for UI display */
  getType(): SignerType;
}

type SignerType = 'nip07' | 'nip46' | 'iframe' | 'local';
```

### Signer Implementations

#### Nip07Signer

Uses browser extension via `window.nostr`:

```typescript
class Nip07Signer implements Signer {
  async getPublicKey(): Promise<string> {
    return window.nostr!.getPublicKey();
  }

  async signEvent(event: UnsignedEvent): Promise<SignedEvent> {
    return window.nostr!.signEvent(event);
  }
}
```

#### Nip46Signer

Uses NIP-46 Nostr Connect for remote signing:

```typescript
class Nip46Signer implements Signer {
  constructor(private connection: Nip46Connection) {}

  async signEvent(event: UnsignedEvent): Promise<SignedEvent> {
    // Send sign request via relay
    // Wait for signed response
  }
}

interface Nip46Connection {
  relay: string;
  remotePubkey: string;
  localPrivkey: string; // Ephemeral key for encryption
}
```

#### IframeSigner

Uses postMessage to hosted signer:

```typescript
class IframeSigner implements Signer {
  constructor(private origin: string) {}

  private iframe: HTMLIFrameElement | null = null;

  async signEvent(event: UnsignedEvent): Promise<SignedEvent> {
    const iframe = await this.getIframe();

    return new Promise((resolve, reject) => {
      const handler = (e: MessageEvent) => {
        if (e.origin !== this.origin) return;
        if (e.data.type === 'sign_response') {
          window.removeEventListener('message', handler);
          resolve(e.data.event);
        }
      };

      window.addEventListener('message', handler);
      iframe.contentWindow!.postMessage({
        type: 'sign_event',
        event
      }, this.origin);
    });
  }
}
```

#### LocalSigner

Uses secp256k1 keys stored in blog's IndexedDB:

```typescript
class LocalSigner implements Signer {
  constructor(
    private privateKey: Uint8Array,
    private options: { showUpgradePrompt?: boolean; isNew?: boolean }
  ) {}

  async signEvent(event: UnsignedEvent): Promise<SignedEvent> {
    // Sign using noble-secp256k1
    return signEvent(event, this.privateKey);
  }
}
```

## SSG Insertion Points

The enhance hook must find the correct insertion point for each SSG's HTML output.

### Detection Strategy

1. **Primary**: Look for `</article>` tag (most SSGs use semantic HTML)
2. **Fallback**: Look for content container patterns
3. **Last resort**: Insert before `</main>` or `</body>`

### SSG-Specific Patterns

| SSG | Primary Pattern | Fallback Pattern | Notes |
|-----|-----------------|------------------|-------|
| Hugo | `</article>` | `.post-content`, `.single-content` | Theme-dependent |
| Hexo | `</article>` | `#article-container`, `.post-body` | Theme-dependent |
| Astro | `</article>` | `<slot />` after content | Layout-dependent |
| Jekyll | `</article>` | `.post-content` | Theme-dependent |
| Zola | `</article>` | `.post`, `.article` | Theme-dependent |
| Moss default | `</article>` | `.content` | Controlled |
| 11ty | `</article>` | `.post`, `main` | Layout-dependent |

### Detection Algorithm

```typescript
function findInsertionPoint(html: string): number {
  // 1. Find last </article> tag (most reliable)
  const articleEnd = html.lastIndexOf('</article>');
  if (articleEnd !== -1) {
    return articleEnd;
  }

  // 2. Look for common content container closes
  const patterns = [
    '</main>',
    '</div><!-- .post-content -->',
    '</div><!-- .entry-content -->',
  ];

  for (const pattern of patterns) {
    const idx = html.lastIndexOf(pattern);
    if (idx !== -1) {
      return idx;
    }
  }

  // 3. Last resort: before </body>
  const bodyEnd = html.lastIndexOf('</body>');
  return bodyEnd !== -1 ? bodyEnd : html.length;
}
```

### Configuration Override

Users can specify a custom selector in config:

```yaml
plugins:
  nostr:
    widget:
      insert_after: ".post-content"  # Custom selector
```

## Preview Scroll Position

When the widget is injected during preview, the page must not jump.

### Strategy

1. **Save scroll position** before any DOM manipulation
2. **Use `requestAnimationFrame`** to batch DOM updates
3. **Restore scroll position** after update

### Implementation

```typescript
// In browser JS (nostr-social.ts)
function injectWithScrollPreservation(container: HTMLElement, html: string) {
  // Save current scroll position
  const scrollY = window.scrollY;
  const scrollX = window.scrollX;

  // Batch DOM update
  requestAnimationFrame(() => {
    container.innerHTML = html;

    // Restore scroll position on next frame
    requestAnimationFrame(() => {
      window.scrollTo(scrollX, scrollY);
    });
  });
}
```

### For Hot Reload / Live Preview

The enhance hook should add a marker attribute so the browser JS knows to preserve scroll:

```html
<section id="nostr-interactions" data-preserve-scroll="true">
```

Browser JS checks this attribute and handles updates accordingly.

## Widget HTML Structure

### Initial (Server-Rendered)

```html
<section id="nostr-interactions" class="moss-comments" data-preserve-scroll="true">
  <!-- Embedded data for hydration -->
  <script type="application/json" id="moss-comments-data">
    {
      "interactions": [...],
      "config": {
        "relays": ["wss://relay.damus.io"],
        "signerOrigin": "https://signer.moss.host"
      }
    }
  </script>

  <!-- No-JS fallback -->
  <noscript>
    <div class="comments-static">
      <h3>Comments (5)</h3>
      <ul>...</ul>
      <p><em>Enable JavaScript to post comments.</em></p>
    </div>
  </noscript>
</section>

<!-- Async loader before </body> -->
<script>
(function() {
  if (!document.getElementById('moss-comments')) return;

  // Load widget JS
  var s = document.createElement('script');
  s.src = '/js/moss-comments.js';
  s.async = true;
  document.body.appendChild(s);

  // Load widget CSS
  var l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = '/css/moss-comments.css';
  document.head.appendChild(l);
})();
</script>
```

### After Hydration

```html
<section id="moss-comments" class="moss-comments loaded">
  <div class="comments-header">
    <h3>Comments (5)</h3>
    <div class="identity-status">
      <!-- Shows current identity state -->
      <span class="identity-badge">npub1abc...</span>
      <button class="sign-out">Switch</button>
    </div>
  </div>

  <div class="comments-list">
    <!-- Rendered comments -->
  </div>

  <div class="comment-form">
    <textarea placeholder="Write a comment..."></textarea>
    <div class="form-actions">
      <button class="submit">Post Comment</button>
      <button class="zap">⚡ Zap</button>
    </div>
  </div>

  <!-- Onboarding modal (shown when needed) -->
  <div class="onboarding-modal" hidden>
    <h4>Sign in to comment</h4>
    <button class="quick-start">Quick Start</button>
    <button class="use-extension">Use Browser Extension</button>
    <button class="use-app">Use Moss App</button>
  </div>

  <!-- Upgrade prompt (shown after local fallback) -->
  <div class="upgrade-prompt" hidden>
    <p>Your identity is stored locally on this blog only.</p>
    <button class="save-key">Save My Key</button>
    <button class="install-app">Install Moss App</button>
  </div>
</section>
```

## File Structure

```
nostr/
├── src/
│   ├── signers/
│   │   ├── index.ts           # Signer interface + getSigner()
│   │   ├── nip07.ts           # NIP-07 extension signer
│   │   ├── nip46.ts           # NIP-46 remote signer
│   │   ├── iframe.ts          # Host iframe signer
│   │   ├── local.ts           # Local IndexedDB signer
│   │   └── types.ts           # Shared signer types
│   ├── widget/
│   │   ├── inject.ts          # SSG-aware HTML injection
│   │   ├── scroll.ts          # Scroll position preservation
│   │   └── detect-ssg.ts      # SSG detection heuristics
│   ├── main.ts                # Plugin entry (process, enhance, syndicate)
│   └── ...
├── browser/
│   ├── moss-comments.ts       # Main browser widget
│   ├── moss-comments.css      # Widget styles
│   ├── signers/               # Browser-side signer implementations
│   │   ├── index.ts
│   │   ├── nip07.ts
│   │   ├── nip46.ts
│   │   ├── iframe.ts
│   │   └── local.ts
│   └── ui/
│       ├── comment-list.ts
│       ├── comment-form.ts
│       ├── onboarding.ts
│       └── upgrade-prompt.ts
└── docs/
    └── comment-widget.md      # This document
```

## Testing Strategy

### Unit Tests

- Signer abstraction (mock each implementation)
- SSG detection (fixture HTML from each SSG)
- Scroll position preservation
- HTML injection correctness

### Integration Tests

- Full enhance hook with sample HTML
- Browser widget hydration (jsdom)

### E2E Tests (CI only)

- Full build with Moss binary
- Widget injection verified in output HTML
- Browser tests with Playwright

## Configuration

```yaml
# moss.yaml
plugins:
  nostr:
    relays:
      - wss://relay.damus.io
      - wss://nos.lol

    widget:
      # Identity host for casual users (default: signer.moss.host)
      signer_origin: "https://signer.moss.host"

      # Custom insertion point (optional)
      insert_after: ".post-content"

      # Disable widget entirely (still fetch interactions)
      enabled: true

      # NIP-46 relay for Moss app connections
      nip46_relay: "wss://relay.moss.social"
```

## Security Considerations

1. **XSS Prevention**: All user content escaped before DOM insertion
2. **Origin Verification**: postMessage handlers verify expected origins
3. **Key Isolation**: Local keys in IndexedDB, not accessible cross-origin
4. **CSP Compatibility**: Widget works with strict CSP (no eval, inline limited)

## Related Documents

- [Decentralized Identity Design](../../../moss/docs/research/decentralized-identity-design.md)
- [NIP-07 Specification](https://nips.nostr.com/7)
- [NIP-46 Specification](https://nips.nostr.com/46)
