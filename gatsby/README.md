# Gatsby Generator Plugin for Moss

Generate static sites using [Gatsby](https://www.gatsbyjs.com/) with Moss's zero-flicker preview and smart-diff refresh.

## Features

- Symlink-based structure translation (efficient, no file duplication)
- React component generation for pages
- GraphQL-based content sourcing
- Smart-diff refresh for instant previews

## Installation

The plugin is bundled with Moss. Configure it in `.moss/config.toml`:

```toml
[hooks]
build = "gatsby-generator"
```

## Configuration

```toml
[hooks]
build = "gatsby-generator"

[plugins.gatsby-generator]
# Path to npm/npx (default: from PATH)
npm_path = "/usr/local/bin/npm"

# Build arguments passed to Gatsby (default: ["build"])
build_args = ["build"]
```

## Structure Translation

The plugin translates Moss's flexible folder structure to Gatsby's expected layout using symlinks:

| Moss Structure | Gatsby Structure | Resulting URL |
|----------------|------------------|---------------|
| `index.md` (homepage) | `src/pages/index.js` | `/` |
| `posts/` (collection) | `src/content/posts/` | `/posts/*` |
| `posts/article.md` | `src/content/posts/article.md` | `/posts/article/` |
| `about.md` (root page) | `src/pages/about.js` | `/about/` |
| `assets/` | `static/assets/` | `/assets/*` |

## How It Works

1. **Structure Translation**: Creates symlinks from your content to Gatsby's expected layout
2. **Page Generation**: Generates React page components for markdown files
3. **Config Generation**: Auto-generates `gatsby-config.js` with plugins and settings
4. **Build**: Runs `gatsby build` to generate static files to `public/`
5. **Preview**: Moss serves the output with smart-diff for instant updates

## Requirements

- Node.js 18+ required
- Gatsby and dependencies are auto-installed via npm if not present

## Development

```bash
npm install          # Install dependencies
npm run build        # Build the plugin
npm test             # Run unit tests
npm run dev          # Watch mode
```

## License

MIT
