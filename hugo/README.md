# Hugo Generator Plugin for Moss

Generate static sites using [Hugo](https://gohugo.io/) with Moss's zero-flicker preview and smart-diff refresh.

## Features

- Automatic Hugo binary resolution (uses system Hugo or auto-downloads)
- Symlink-based structure translation (efficient, no file duplication)
- Cross-platform support (macOS, Linux, Windows)
- Smart-diff refresh for instant previews

## Installation

The plugin is bundled with Moss. Configure it in `.moss/config.toml`:

```toml
[hooks]
build = "hugo-generator"
```

## Configuration

```toml
[hooks]
build = "hugo-generator"

[plugins.hugo-generator]
# Path to Hugo binary (default: auto-detect or download)
hugo_path = "/usr/local/bin/hugo"

# Build arguments passed to Hugo (default: ["--minify"])
build_args = ["--minify", "--gc"]
```

## Structure Translation

The plugin translates Moss's flexible folder structure to Hugo's expected layout using symlinks:

| Moss Structure | Hugo Structure | Resulting URL |
|----------------|----------------|---------------|
| `index.md` (homepage) | `content/_index.md` | `/` |
| `posts/` (collection) | `content/posts/` | `/posts/*` |
| `posts/article.md` | `content/posts/article.md` | `/posts/article/` |
| `about.md` (root page) | `content/about.md` | `/about/` |
| `assets/` | `static/assets/` | `/assets/*` |

## How It Works

1. **Binary Resolution**: Finds Hugo in PATH or auto-downloads if not found
2. **Structure Translation**: Creates symlinks from your content to Hugo's expected layout
3. **Build**: Runs Hugo to generate static files
4. **Preview**: Moss serves the output with smart-diff for instant updates

## Requirements

- Hugo is auto-downloaded if not installed
- Or install manually: [Hugo Installation Guide](https://gohugo.io/installation/)

## Development

```bash
npm install          # Install dependencies
npm run build        # Build the plugin
npm test             # Run unit tests
npm run test:e2e     # Run E2E tests (requires Hugo)
npm run dev          # Watch mode
```

## License

MIT
