# Comment Plugin Setup

The comment plugin has two layers:

1. **Static comments** (no server needed) — renders existing comments from JSON files in `.moss/social/` as HTML at build time
2. **Live comments** (requires a comment server) — visitors can submit new comments via a form

Static comments work out of the box. This guide covers setting up a comment server for live comments. Two providers are supported: **Artalk** (recommended) and **Waline**.

---

## Provider: Artalk (recommended)

[Artalk](https://artalk.js.org/) is a self-hosted comment system written in Go. It ships as a single binary with an embedded SQLite database — no external database service required.

**Why Artalk:**

- **Single Go binary** — one container, no separate database container
- **SQLite by default** — zero-config persistence, easy backups (one file)
- **Built-in SMTP email notifications** — reply notifications, like notifications, admin alerts, all configurable from the admin dashboard
- **Multi-site support** — one Artalk instance serves multiple websites (each with its own `site_name`)
- **Admin dashboard** — manage comments, users, sites, and settings from a web UI
- **Chinese + English documentation** — first-class support for both languages

### Hosting: Hong Kong VPS

A Hong Kong VPS provides the best latency for users in both China and the US, without requiring ICP filing.

**Recommended: Server.HK**

- ~$4/month for 1 CPU, 2 GB RAM, 30 GB SSD
- CN2 GIA unmetered bandwidth
- <25 ms latency from Guangzhou/Shanghai
- ~180 ms from US West Coast

**Alternatives:**

| Provider | Price | Notes |
|----------|-------|-------|
| [LightNode](https://www.lightnode.com/) | ~$8/month | CN2 + BGP, hourly billing |
| [BandwagonHost](https://bandwagonhost.com/) | ~$90/year | HK CN2 GIA, Equinix HK2 datacenter |

**Minimum requirements:** 1 CPU, 1 GB RAM, 10 GB disk. Artalk idles at ~20 MB RAM.

**Why HK VPS (not Vercel/serverless):**

- No ICP filing needed (mainland China servers require ICP)
- Good latency to China (<25 ms via CN2 GIA) and acceptable to US (~180 ms)
- Persistent process with SQLite — no cold starts, no external database
- See [China + US Access Notes](#china--us-access-notes) for why other hosting options fail

### Deployment: Docker Compose

Create a directory on your VPS (e.g., `/opt/artalk`) with two files:

**docker-compose.yml:**

```yaml
services:
  artalk:
    image: artalk/artalk-go
    container_name: artalk
    restart: unless-stopped
    ports:
      - "8080:23366"
    volumes:
      - ./data:/data
    environment:
      - TZ=Asia/Hong_Kong

  caddy:
    image: caddy:2
    container_name: caddy
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - artalk

volumes:
  caddy_data:
  caddy_config:
```

**Caddyfile:**

```
comments.example.com {
    reverse_proxy artalk:8080
}
```

Replace `comments.example.com` with your actual domain. Caddy handles TLS certificate provisioning automatically via Let's Encrypt.

**DNS:** Point your domain's A record to your VPS IP before starting the containers.

### Admin Setup

```bash
# Start the containers
docker compose up -d

# Wait for Artalk to initialize (~5 seconds)
docker compose logs artalk
```

1. Visit `https://comments.example.com` in your browser
2. On first visit, Artalk prompts you to create an admin account
3. Log in to the admin dashboard
4. Go to **Settings > Sites** and add a site (e.g., `my-blog`) — this is the `site_name` you'll use in the plugin config
5. Configure email notifications (see below)

### Email Notifications (SMTP)

Artalk sends email notifications when someone replies to a comment or when a new comment is submitted (admin notification). Configure SMTP in the admin dashboard under **Settings > Email**.

**SMTP options:**

| Service | SMTP Host | Port | Notes |
|---------|-----------|------|-------|
| Gmail | `smtp.gmail.com` | 587 | Requires [App Password](https://myaccount.google.com/apppasswords) |
| QQ Mail | `smtp.qq.com` | 587 | Requires authorization code from QQ Mail settings |
| Resend | `smtp.resend.com` | 587 | API key as password, `resend` as username |

Artalk also supports: Alibaba Cloud DirectMail and local sendmail.

**Additional notification channels** (configured in dashboard under Settings > Notifications):

Telegram, Feishu, DingTalk, Bark, Slack, LINE

### CORS Configuration

Artalk has built-in CORS support. In the admin dashboard under **Settings > Trusted Domains**, add your site's domain. Or configure via the Artalk config file (`data/artalk.yml`):

```yaml
trusted_domains:
  - https://your-site.com
  - https://www.your-site.com
```

### API Reference

The plugin uses two Artalk REST endpoints:

**POST /api/v2/comments** — submit a new comment

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `content` | string | yes | Comment body (Markdown supported) |
| `name` | string | yes | Commenter's display name |
| `email` | string | yes | Commenter's email |
| `page_key` | string | yes | Page path (e.g., `/posts/my-article.html`) |
| `site_name` | string | yes | Site name configured in Artalk admin |
| `link` | string | no | Commenter's website URL |
| `rid` | number | no | Parent comment ID (for replies) |
| `ua` | string | no | User agent string |

**GET /api/v2/comments** — list comments for a page

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `page_key` | string | yes | Page path |
| `site_name` | string | yes | Site name |
| `limit` | number | no | Comments per page (default 20) |
| `offset` | number | no | Pagination offset |
| `sort_by` | string | no | Sort order (e.g., `date_desc`, `date_asc`) |
| `flat_mode` | boolean | no | Flat list instead of nested tree |

**Note:** Artalk uses standard HTTP status codes (200 for success, 400/404/500 for errors). This differs from Waline, which returns `errno`/`errmsg` fields in the response body.

### Verification

```bash
# Submit a test comment
curl -X POST https://comments.example.com/api/v2/comments \
  -H 'Content-Type: application/json' \
  -d '{
    "content": "Test comment from curl",
    "name": "Test User",
    "email": "test@example.com",
    "page_key": "/posts/my-article.html",
    "site_name": "my-blog"
  }'

# Fetch comments for a page
curl "https://comments.example.com/api/v2/comments?page_key=/posts/my-article.html&site_name=my-blog"
```

**Testing email notifications:** Submit a comment, then reply to it using a different email address. The original commenter should receive an email notification. Check the admin dashboard under **Settings > Email** for send logs if emails are not arriving.

---

## Provider: Waline

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

### Option B: LeanCloud + Vercel (free)

LeanCloud provides the database backend; Vercel hosts the Waline server. LeanCloud's free tier gives 30K API requests/day with no ID verification.

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

### Waline API Endpoints

The plugin talks to two Waline REST endpoints:

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/comment` | Submit a new comment |
| `GET` | `/api/comment?path=/page.html&pageSize=50` | Fetch comments for a page |

No Waline client library is loaded. The plugin generates ~3KB of inline vanilla JS that calls these endpoints directly via `fetch()`.

### Waline CORS

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

### Waline Verification

```bash
# Fetch comments for a page
curl https://your-waline-server.com/api/comment?path=/posts/my-article.html

# Submit a test comment
curl -X POST https://your-waline-server.com/api/comment \
  -H 'Content-Type: application/json' \
  -d '{"comment":"Test comment","nick":"Test","mail":"","link":"","url":"/posts/my-article.html"}'
```

---

## Plugin Configuration

In moss, open the comment plugin settings and configure:

**For Artalk (recommended):**

```json
{
  "provider": "artalk",
  "server_url": "https://comments.example.com",
  "site_name": "my-blog"
}
```

| Setting | Value |
|---------|-------|
| `provider` | `artalk` |
| `server_url` | Your Artalk server URL (e.g., `https://comments.example.com`) |
| `site_name` | Site name configured in Artalk admin dashboard |

**For Waline:**

```json
{
  "provider": "waline",
  "server_url": "https://your-waline-server.com"
}
```

| Setting | Value |
|---------|-------|
| `provider` | `waline` |
| `server_url` | Your Waline server URL (e.g., `https://comments.example.com`) |

Edit `.moss/plugins/comment/config.json` directly, or use the plugin settings UI in moss.

After setting `server_url`, rebuild your site. Each article page will now include:
- A comment submission form (name, email, website, comment body)
- Client-side JS that POSTs to the provider's API
- A script that fetches newer comments from the server on page load

Without `server_url`, only static comments from `.moss/social/` are rendered (no form, no JS).

---

## Opting out per page

Add `comments: false` to any article's frontmatter to hide the comment section:

```yaml
---
title: My Private Page
comments: false
---
```

---

## China + US Access Notes

If your audience spans China and the US, hosting location matters. Here is why a Hong Kong VPS is the recommended choice, and why common alternatives fail.

**Why HK VPS works:**

- No ICP filing required (mainland China servers require an ICP license to serve websites)
- Low latency to mainland China: <25 ms via CN2 GIA routing from Guangzhou/Shanghai
- Acceptable latency to US: ~180 ms from US West Coast
- Persistent server process — SQLite works, no cold start penalty

**Why not Vercel:**

- `vercel.app` domains are DNS-polluted in China (resolve to wrong IPs)
- Even custom domains on Vercel are blocked: Vercel edge IPs trigger SNI-based filtering
- Result: comment form and API calls fail silently for Chinese visitors

**Why not LeanCloud International:**

- LeanCloud International (`leancloud.app`) started blocking China IP addresses in August 2022 as a policy decision
- The free tier that Waline docs recommend is the international version
- LeanCloud China (`.cn`) requires real-name verification and ICP filing

**Why not Fly.io Hong Kong region:**

- Fly.io's `hkg` region routes mainland China traffic through LAX (Los Angeles) due to their network topology
- Effective latency from China is 200-300 ms, not the expected 25 ms
- Defeats the purpose of choosing Hong Kong

**Why not Tencent CloudBase:**

- Excellent in China (low latency, no ICP needed for serverless functions)
- Unknown reliability and latency for US/international visitors
- Vendor lock-in to Tencent ecosystem

**Email delivery from HK VPS:**

The Great Firewall does not block server-to-server SMTP connections. An Artalk instance in Hong Kong using Gmail SMTP or Resend can deliver notification emails to `qq.com`, `163.com`, and other Chinese email providers without issues. The GFW blocks consumer-facing services (websites, apps), not backend mail relay.
