# Comment Plugin Setup

The comment plugin has two layers:

1. **Static comments** (no server needed) — renders existing comments from `.moss/social/matters.json` as HTML at build time
2. **Live comments** (requires a Waline server) — visitors can submit new comments via a form

Static comments work out of the box. This guide covers setting up the Waline server for live comments.

## Waline Server

[Waline](https://waline.js.org/) is a lightweight comment backend with a clean REST API. The comment plugin uses Waline as a standard HTTP endpoint — no Waline client JS is loaded.

### Option A: Local testing (Docker)

```bash
docker run -d \
  --name waline \
  -p 8360:8360 \
  -e SQLITE_PATH=/app/data \
  -e JWT_TOKEN=testing-secret \
  -v waline-data:/app/data \
  lizheming/waline
```

Then set `server_url` to `http://localhost:8360`.

### Option B: LeanCloud (free, recommended for production)

LeanCloud's free tier gives 30K API requests/day with no ID verification.

1. **Create a LeanCloud account** at https://console.leancloud.app/

2. **Create an application** — choose the Developer (free) plan

3. **Get your credentials** — go to Settings > App Keys and note:
   - `LEAN_ID` (App ID)
   - `LEAN_KEY` (App Key)
   - `LEAN_MASTER_KEY` (Master Key)

4. **Deploy Waline** — the easiest way is Vercel:

   [![Deploy to Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fwalinejs%2Fwaline%2Ftree%2Fmain%2Fpackages%2Fserver&env=LEAN_ID,LEAN_KEY,LEAN_MASTER_KEY&envDescription=LeanCloud%20credentials&project-name=waline&repository-name=waline)

   Set the three environment variables from step 3.

5. Your Waline server is now at `https://your-project.vercel.app`

### Option C: Self-hosted (Docker + LeanCloud)

```bash
docker run -d \
  --name waline \
  -p 8360:8360 \
  -e LEAN_ID=your_app_id \
  -e LEAN_KEY=your_app_key \
  -e LEAN_MASTER_KEY=your_master_key \
  -e LEAN_SERVER=https://your-leancloud-api-domain.com \
  lizheming/waline
```

### Option D: Self-hosted (Docker + SQLite, no LeanCloud)

For a fully self-contained setup without any external database:

```bash
docker run -d \
  --name waline \
  -p 8360:8360 \
  -e SQLITE_PATH=/app/data \
  -e JWT_TOKEN=$(openssl rand -hex 32) \
  -v waline-data:/app/data \
  lizheming/waline
```

## Configuring the Plugin

In moss, open the comment plugin settings and set:

| Setting | Value |
|---------|-------|
| `provider` | `waline` |
| `server_url` | Your Waline server URL (e.g. `https://comments.example.com`) |

Or edit `.moss/plugins/comment/config.json` directly:

```json
{
  "provider": "waline",
  "server_url": "https://comments.example.com"
}
```

After setting `server_url`, rebuild your site. Each article page will now include:
- A comment submission form (name, email, website, comment body)
- Client-side JS that POSTs to `{server_url}/api/comment`
- A script that fetches newer comments from the server on page load

Without `server_url`, only static comments from `.moss/social/` are rendered (no form, no JS).

## Opting out per page

Add `comments: false` to any article's frontmatter to hide the comment section:

```yaml
---
title: My Private Page
comments: false
---
```

## API endpoints used

The plugin talks to two Waline REST endpoints:

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/comment` | Submit a new comment |
| `GET` | `/api/comment?path=/page.html&pageSize=50` | Fetch comments for a page |

No Waline client library is loaded. The plugin generates ~3KB of inline vanilla JS that calls these endpoints directly via `fetch()`.

## CORS

If your Waline server is on a different domain than your site, configure CORS on the server. For Vercel deployments, add a `vercel.json`:

```json
{
  "headers": [
    {
      "source": "/api/(.*)",
      "headers": [
        { "key": "Access-Control-Allow-Origin", "value": "https://your-site.com" },
        { "key": "Access-Control-Allow-Methods", "value": "GET,POST,OPTIONS" },
        { "key": "Access-Control-Allow-Headers", "value": "Content-Type" }
      ]
    }
  ]
}
```

For Docker deployments, set the `CORS` environment variable:

```bash
docker run -d \
  -e CORS=https://your-site.com \
  # ... other flags
  lizheming/waline
```

## Verifying it works

1. Open your built site in a browser
2. Navigate to an article page
3. You should see the comment form at the bottom
4. Submit a test comment — it should appear immediately below the form
5. Refresh the page — the comment should persist (fetched from the server)

To verify the API directly:

```bash
# Fetch comments for a page
curl https://your-waline-server.com/api/comment?path=/posts/my-article.html

# Submit a test comment
curl -X POST https://your-waline-server.com/api/comment \
  -H 'Content-Type: application/json' \
  -d '{"comment":"Test comment","nick":"Test","mail":"","link":"","url":"/posts/my-article.html"}'
```
