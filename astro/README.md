# Astro Generator Plugin for Moss

Generate static sites using [Astro](https://astro.build/) with Moss's zero-flicker preview and smart-diff refresh.

## Features

- Symlink-based structure translation (efficient, no file duplication)
- Content collections support for blog posts and pages
- Automatic Astro component wrapping for markdown
- Smart-diff refresh for instant previews

## Installation

The plugin is bundled with Moss. Configure it in `.moss/config.toml`:

```toml
[hooks]
build = "astro-generator"
```

## Configuration

```toml
[hooks]
build = "astro-generator"

[plugins.astro-generator]
# Path to npm/npx (default: from PATH)
npm_path = "/usr/local/bin/npm"

# Build arguments passed to Astro (default: ["build"])
build_args = ["build"]
```

## Structure Translation

The plugin translates Moss's flexible folder structure to Astro's expected layout using symlinks:

| Moss Structure | Astro Structure | Resulting URL |
|----------------|-----------------|---------------|
| `index.md` (homepage) | `src/pages/index.astro` | `/` |
| `posts/` (collection) | `src/content/posts/` | `/posts/*` |
| `posts/article.md` | `src/content/posts/article.md` | `/posts/article/` |
| `about.md` (root page) | `src/pages/about.astro` | `/about/` |
| `assets/` | `public/assets/` | `/assets/*` |

## How It Works

1. **Structure Translation**: Creates symlinks from your content to Astro's expected layout
2. **Component Generation**: Wraps markdown in Astro page components
3. **Config Generation**: Auto-generates `astro.config.mjs` with site settings
4. **Build**: Runs `astro build` to generate static files to `dist/`
5. **Preview**: Moss serves the output with smart-diff for instant updates

## Requirements

- Node.js 18+ required
- Astro is auto-installed via npm if not present

## Development

```bash
npm install          # Install dependencies
npm run build        # Build the plugin
npm test             # Run unit tests
npm run dev          # Watch mode
```

## License

MIT
