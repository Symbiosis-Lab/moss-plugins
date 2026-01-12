# Eleventy Generator Plugin for Moss

Generate static sites using [Eleventy (11ty)](https://www.11ty.dev/) with Moss's zero-flicker preview and smart-diff refresh.

## Features

- Symlink-based structure translation (efficient, no file duplication)
- Simple, flexible configuration
- Nunjucks templating support
- Smart-diff refresh for instant previews

## Installation

The plugin is bundled with Moss. Configure it in `.moss/config.toml`:

```toml
[hooks]
build = "eleventy-generator"
```

## Configuration

```toml
[hooks]
build = "eleventy-generator"

[plugins.eleventy-generator]
# Path to npx (default: from PATH)
npx_path = "/usr/local/bin/npx"

# Build arguments passed to Eleventy (default: [])
build_args = ["--quiet"]
```

## Structure Translation

The plugin translates Moss's flexible folder structure to Eleventy's expected layout using symlinks:

| Moss Structure | Eleventy Structure | Resulting URL |
|----------------|-------------------|---------------|
| `index.md` (homepage) | `src/index.md` | `/` |
| `posts/` (collection) | `src/posts/` | `/posts/*` |
| `posts/article.md` | `src/posts/article.md` | `/posts/article/` |
| `about.md` (root page) | `src/about.md` | `/about/` |
| `assets/` | `src/assets/` | `/assets/*` |

## How It Works

1. **Structure Translation**: Creates symlinks from your content to Eleventy's expected layout
2. **Config Generation**: Auto-generates `eleventy.config.js` with site settings
3. **Layout Generation**: Creates default Nunjucks layouts for pages and posts
4. **Build**: Runs Eleventy to generate static files to `_site/`
5. **Preview**: Moss serves the output with smart-diff for instant updates

## Requirements

- Node.js 18+ required
- Eleventy is auto-installed via npx if not present

## Development

```bash
npm install          # Install dependencies
npm run build        # Build the plugin
npm test             # Run unit tests
npm run dev          # Watch mode
```

## License

MIT
