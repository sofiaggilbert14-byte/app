# Charm IPTV — Cloudflare backend (Free plan)

Fast JSON API for the Charm IPTV Android TV app. **No M3U/XML parsing on the device.**

## How it works
```
GitHub Actions (every 6h)  ->  parses M3U + gzipped EPG  ->  writes gzipped JSON to Cloudflare KV
Cloudflare Worker (free)   ->  reads KV, returns instant JSON  ->  the app just fetches & shows it
```
Heavy parsing runs on GitHub's servers (Cloudflare Free has a 10 ms CPU limit that can't parse a 16 MB EPG). The Worker stays a thin, fast serve layer.

## Endpoints
| Method | Path | Returns |
|---|---|---|
| GET | `/config` | version, maintenance, announcements, lastUpdated, channelCount |
| GET | `/channels` | `[{ id, tvgId, name, logo, category, url }]` (gzipped) |
| GET | `/guide` | `{ updatedAt, channels: [{ id, p:[{t,s,e,d,c}] }] }` (gzipped) |
| GET | `/channel/{id}` | `{ id, name, logo, category, now, next, serverTime }` (computed live) |

Program fields: `t`=title, `s`=start (epoch ms), `e`=end (epoch ms), `d`=desc, `c`=category.

---

## One-time setup (≈10 minutes)

### 1) Create a Cloudflare KV namespace
Dashboard → **Storage & Databases → KV → Create namespace** → name it `CHARM_KV`.
Copy its **Namespace ID** and paste it into `worker/wrangler.toml` (`id = "..."`).
Also copy your **Account ID** (Dashboard home → right sidebar).

### 2) Create a Cloudflare API token
Dashboard → **My Profile → API Tokens → Create Token → Create Custom Token**:
- Permissions:
  - **Account → Workers KV Storage → Edit**
  - **Account → Workers Scripts → Edit**
- Account Resources: your account.
- Create and **copy the token** (shown once).

### 3) Add GitHub repo secrets
Repo → **Settings → Secrets and variables → Actions → New repository secret**:
- `CF_ACCOUNT_ID` = your Account ID
- `CF_KV_NAMESPACE_ID` = your KV Namespace ID
- `CF_API_TOKEN` = the token from step 2

### 4) Deploy the Worker
From `cloudflare-backend/worker/`:
```bash
npm install
npx wrangler login        # opens a browser to authorize
npx wrangler deploy
```
This prints your live URL, e.g. `https://charm-iptv-api.<your-subdomain>.workers.dev`.

### 5) Populate the data (first run)
Repo → **Actions → “Refresh Charm IPTV data” → Run workflow**.
After it finishes (~1 min), open `https://<your-worker-url>/config` — you should see `"ready": true`.
It then re-runs automatically every 6 hours.

---

## Test it
```bash
curl https://<your-worker-url>/config
curl https://<your-worker-url>/channels --compressed | head -c 400
curl https://<your-worker-url>/guide --compressed | head -c 400
curl https://<your-worker-url>/channel/<some-id>
```

## Notes for Android TV / Fire Stick
- Responses are gzipped + edge-cached; okhttp (React Native) auto-decompresses.
- The app fetches `/channels` + `/guide` once and renders — no XML/M3U work, low memory, no freeze.
- If m3u4u is down at refresh time, the builder skips the write and the Worker keeps serving the **last good data**.
- To show a maintenance banner or announcement without redeploying: set `MAINTENANCE`/`ANNOUNCEMENTS` env in the workflow, or later we can point them at KV.

## Local run of the builder (optional)
```bash
CF_ACCOUNT_ID=... CF_KV_NAMESPACE_ID=... CF_API_TOKEN=... \
  node cloudflare-backend/scripts/build-and-upload.mjs
```
