# Hugo Generator Plugin for Moss

Generate static sites using [Hugo](https://gohugo.io/) with Moss's zero-flicker preview and smart-diff refresh.

## Installation

1. Copy the plugin to your project:
   ```bash
   cp -r hugo-generator/ your-project/.moss/plugins/
   ```

2. Configure Moss to use the Hugo generator in `.moss/config.toml`:
   ```toml
   [hooks]
   build = "hugo-generator"
   ```

## Configuration

Configure the plugin in `.moss/config.toml`:

```toml
[hooks]
build = "hugo-generator"

[plugins.hugo-generator]
# Path to Hugo binary (default: "hugo" from PATH)
hugo_path = "/usr/local/bin/hugo"

# Build arguments passed to Hugo (default: ["--minify"])
build_args = ["--minify", "--gc"]
```

## Requirements

- [Hugo](https://gohugo.io/installation/) must be installed and available in PATH (or configured via `hugo_path`)
- Your project should be a valid Hugo site (with `hugo.toml` or `config.toml`)

## How It Works

1. When you save a file, Moss detects the change
2. Moss calls the Hugo generator plugin
3. Hugo builds your site to `.moss/site-stage/`
4. Moss compares output hashes (smart-diff)
5. Moss atomically switches the preview to show new content (zero-flicker)
6. Browser only refreshes if the current page changed

## Development

```bash
# Install dependencies
npm install

# Build the plugin
npm run build

# Run unit tests
npm test

# Run E2E tests (requires Hugo installed)
npm run test:e2e

# Watch mode for development
npm run dev
```

## License

MIT
