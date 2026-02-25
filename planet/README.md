# Planet Syndicator Plugin (Proposal)

> **Status:** Future plugin idea — not yet implemented.

Syndicate your moss site to [IPFS](https://ipfs.tech) via [Planet](https://github.com/Planetable/Planet), making it available peer-to-peer while keeping the canonical site on HTTP.

## Vision

One publish action, two distribution networks:

```
Right-click folder → Publish → preview → click Publish → done.

Reader visits your-site.com:
  Has IPFS?  → content loads peer-to-peer
  No IPFS?   → content loads normally via HTTP
```

The visitor's browser decides. The creator doesn't think about it.

## Why a Syndicator, Not a Deployer

moss enforces a single deploy plugin by design — deploy means "put the canonical site live." IPFS via Planet is a mirror, not the canonical host. If pinning fails, the site is still live on GitHub Pages. This matches the syndicate model:

```toml
[hooks]
deploy = "github"                          # ONE deployer (canonical)
syndicate = ["planet", "matters", "email"]  # MULTIPLE syndicators

[hooks.planet]
set_dnslink = true
```

Planet appears as a syndicator toggle in the control panel alongside Matters and Email.

## How It Works

### Publish Flow

```
User clicks Publish
       ↓
Deploy plugin (GitHub Pages) uploads .moss/site/ to HTTP host
  → your-site.com is live
       ↓
Planet syndicator plugin fires (after deploy):
  1. Hands .moss/site/ to Planet's local IPFS node
  2. Planet pins content, returns CID + IPNS address
  3. Plugin sets DNSLink TXT record on domain:
     _dnslink.your-site.com TXT "dnslink=/ipfs/bafybei..."
       ↓
Done. Site is live on HTTP and discoverable on IPFS.
```

### Reader Experience

**IPFS-aware browser** (Brave, or any browser with [IPFS Companion](https://docs.ipfs.tech/install/ipfs-companion/)):
1. Detects [DNSLink](https://dnslink.dev) TXT record on `your-site.com`
2. Resolves IPFS CID from the TXT record
3. Loads content peer-to-peer
4. Planet users can follow the site via IPNS

**Regular browser** (Chrome, Safari, Firefox):
1. DNS resolves to GitHub Pages as usual
2. Site loads over HTTP — nothing changes

[DNSLink](https://dnslink.dev) makes this transparent. Same domain, same URL, two resolution paths.

## Integration with Planet

Planet already has a ["Published Folders"](https://planetable.eth.limo/DFF2DC03-9CFA-4F35-8227-B01E5407F1B2/) feature that publishes any local directory to IPFS. The integration needs Planet to expose a programmatic interface — one of:

1. **URL scheme** (simplest, macOS-native):
   ```
   planet://publish-folder?path=/Users/you/.moss/site
   ```

2. **Local HTTP API** (more flexible, supports progress):
   ```
   POST http://localhost:PORT/api/publish-folder
   { "path": "/Users/you/.moss/site" }
   ```

3. **Folder watch** (zero-coordination):
   Planet watches `.moss/site/` and auto-publishes on change.

**Required return value:** CID and IPNS address, so moss can set the DNSLink TXT record.

### Fallback: Direct Pinning API

If Planet is not installed, the plugin could fall back to a pinning service API ([Pinata](https://www.pinata.cloud/), [web3.storage](https://web3.storage/)) to upload files directly. Simpler, but misses Planet's local node and follower network — Planet users who follow your IPNS become nodes that help serve your content.

## Configuration

```toml
[hooks.planet]
set_dnslink = true              # Auto-set DNS TXT record after pinning
# pinning_fallback = "pinata"   # Optional: fallback if Planet not running
# api_key = "..."               # API key for fallback pinning service
```

## User Tiers

**"I just want to publish"** — No change. GitHub Pages deploys as today. Planet plugin not enabled.

**"I want p2p too"** — Install Planet (one-time), enable plugin in moss. One click publishes to HTTP + IPFS.

**"I want .eth"** — Same as above, plus set ENS content hash to IPNS address (Planet already supports this). Now `name.eth` resolves via IPFS and `site.com` resolves via HTTP. Same content, two naming systems.

## Why Planet + moss Together

| | moss alone | Planet alone | moss + Planet |
|---|---|---|---|
| Authoring | Any editor, markdown folders | Built-in editor only | Any editor, markdown folders |
| Theming | Full CSS + HTML templates | Stencil templates | Full CSS + HTML templates |
| Preview | Zero-flicker live reload | Basic preview | Zero-flicker live reload |
| HTTP | GitHub Pages, custom domains | Gateways only (.eth.limo) | GitHub Pages + gateways |
| IPFS | None | Local node + pinning | Local node + pinning |
| Discovery | DNS, search engines | ENS, IPNS, Planet reader | DNS + ENS + IPNS + search |
| Followers | None | P2P pinning by followers | P2P pinning by followers |

Maximum reach (HTTP for everyone) with maximum resilience (IPFS for permanence).

## References

- [Planet — Build and host decentralized blogs on your Mac](https://github.com/Planetable/Planet)
- [Planet "Published Folders" feature](https://planetable.eth.limo/DFF2DC03-9CFA-4F35-8227-B01E5407F1B2/)
- [DNSLink specification](https://dnslink.dev)
- [IPFS addressing on the web](https://docs.ipfs.tech/how-to/address-ipfs-on-web/)
- [IPFS Companion browser extension](https://docs.ipfs.tech/install/ipfs-companion/)
- [ENS (Ethereum Name Service)](https://ens.domains/)
- [Matters syndicator plugin](../matters/) — reference implementation for moss syndicator pattern
- [Nostr plugin](../nostr/) — reference implementation for multi-hook plugin (process + enhance + syndicate)

## License

MIT
