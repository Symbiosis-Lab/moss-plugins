# Matters Syndicator Plugin

[![Test & Coverage](https://github.com/Symbiosis-Lab/matters-syndicator-plugin/actions/workflows/test.yml/badge.svg)](https://github.com/Symbiosis-Lab/matters-syndicator-plugin/actions/workflows/test.yml)
[![codecov](https://codecov.io/gh/Symbiosis-Lab/matters-syndicator-plugin/branch/main/graph/badge.svg)](https://codecov.io/gh/Symbiosis-Lab/matters-syndicator-plugin)

A moss plugin that syndicates your articles to [Matters.town](https://matters.town) using the POSSE (Publish Own Site, Syndicate Everywhere) approach.

## Features

- ✅ Automatic syndication to Matters.town after deployment
- ✅ Canonical links back to your original site
- ✅ Authentication check before build
- ✅ Configurable auto-publish
- ✅ Tag preservation

## Development Setup

### Install Dependencies

```bash
npm install
```

### Build

```bash
npm run build
```

This will:
1. Clean the `dist/` folder
2. Compile TypeScript to JavaScript
3. Copy assets (manifest.json, icon.svg) to `dist/`

### Watch Mode

```bash
npm run watch
```

Automatically rebuilds on file changes.

### Symlink to Test Project

```bash
cd ../matters-test/.moss/plugins
ln -s ../../../matters-syndicator-plugin/dist matters-syndicator
```

## Configuration

Add to your project's `.moss/config.toml`:

```toml
[hooks]
after_deploy = ["matters-syndicator"]

[plugins.matters-syndicator]
enabled = true
auto_publish = false        # Set to true to auto-publish (default: false = draft only)
add_canonical_link = true   # Add canonical link to original site (default: true)
```

## Hooks

### `before_build`

Checks if user is authenticated with Matters.town. Fails early if not authenticated.

### `after_deploy`

Syndicates all articles to Matters.town after successful deployment:
- Creates drafts (or publishes if `auto_publish = true`)
- Adds canonical links back to your site
- Preserves tags from frontmatter

## TODO

- [ ] Implement actual Matters.town API integration
- [ ] Implement authentication check via webview cookies
- [ ] Add duplicate detection to avoid re-syndicating
- [ ] Add configuration UI for plugin settings
- [ ] Support for updating existing Matters articles
