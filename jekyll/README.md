# Jekyll Generator Plugin for Moss

Generate static sites using [Jekyll](https://jekyllrb.com/) with Moss's zero-flicker preview and smart-diff refresh.

## Features

- Symlink-based structure translation (efficient, no file duplication)
- Automatic `_posts/` directory mapping for blog posts
- Kramdown markdown processor with GFM support
- Smart-diff refresh for instant previews

## Installation

The plugin is bundled with Moss. Configure it in `.moss/config.toml`:

```toml
[hooks]
build = "jekyll-generator"
```

## Configuration

```toml
[hooks]
build = "jekyll-generator"

[plugins.jekyll-generator]
# Path to Jekyll binary (default: "jekyll" from PATH)
jekyll_path = "/usr/local/bin/jekyll"

# Build arguments passed to Jekyll (default: ["build"])
build_args = ["build", "--drafts"]
```

## Structure Translation

The plugin translates Moss's flexible folder structure to Jekyll's expected layout using symlinks:

| Moss Structure | Jekyll Structure | Resulting URL |
|----------------|------------------|---------------|
| `index.md` (homepage) | `index.md` | `/` |
| `posts/` (collection) | `_posts/` | `/posts/*` |
| `posts/article.md` | `_posts/article.md` | `/posts/article/` |
| `about.md` (root page) | `about.md` | `/about/` |
| `assets/` | `assets/` | `/assets/*` |

## How It Works

1. **Structure Translation**: Creates symlinks from your content to Jekyll's expected layout
2. **Config Generation**: Auto-generates `_config.yml` with site settings
3. **Build**: Runs Jekyll to generate static files to `_site/`
4. **Preview**: Moss serves the output with smart-diff for instant updates

## Requirements

- Jekyll must be installed: `gem install jekyll bundler`
- Ruby 2.7+ recommended

## Development

```bash
npm install          # Install dependencies
npm run build        # Build the plugin
npm test             # Run unit tests
npm run dev          # Watch mode
```

## License

MIT
