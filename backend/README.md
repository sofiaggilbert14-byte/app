# Legacy FastAPI backend (preview / admin)

This tree is legacy. The shipped Fire TV / Purple Next APK fetches its playlist
and EPG directly through the native Kotlin path and does not call these routes
in production.

Keep this server for web-preview proxying and historical admin flows only:

- `SOURCE_M3U_URL` / `SOURCE_EPG_URL`: optional provider defaults. Never
  hardcode provider URLs in source.
- `PROXY_ALLOW_HOSTS`: required comma-separated host allowlist for
  `/api/proxy`. The proxy is disabled when this value is empty.
- `CORS_ALLOW_ORIGINS`: optional comma-separated web-preview origins. An empty
  value emits no browser CORS permission; wildcard origins are ignored.
- `MAX_PLAYLIST_DOWNLOAD_BYTES`, `MAX_EPG_DOWNLOAD_BYTES`,
  `MAX_EPG_DECOMPRESSED_BYTES`, and `MAX_PROXY_BYTES`: caps for untrusted
  provider responses. The defaults are 64 MiB, 256 MiB, 512 MiB, and 64 MiB.

Source URLs are only returned by the authenticated settings route. Refresh and
settings mutations require the admin bearer token. XMLTV downloads are spooled
and parsed incrementally so large guides do not require one full in-memory XML
tree.
