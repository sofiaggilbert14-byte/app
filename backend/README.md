# Legacy FastAPI backend (preview / admin)

This tree is **legacy**. The shipped Fire TV / Purple Next APK fetches playlist
and EPG directly (native Kotlin XMLTV path) and does not call these routes in
production.

Keep this server for web-preview proxying and historical admin flows only:

- `SOURCE_M3U_URL` / `SOURCE_EPG_URL` — optional defaults (never hardcode
  provider URLs in source).
- `PROXY_ALLOW_HOSTS` — optional comma-separated host allowlist for `/api/proxy`.
  When unset, the proxy still blocks localhost, link-local, and private
  resolvable addresses (SSRF guard).

Do not expose `/api/proxy` on the public internet without an allowlist.
