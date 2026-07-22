#!/usr/bin/env node
/**
 * Charm IPTV — data builder (runs on GitHub Actions every 6h).
 *
 * Downloads the M3U playlist + gzipped EPG, parses them on a full-power runner,
 * builds compact/optimized JSON, gzips the big payloads, and writes everything
 * to Cloudflare KV via the REST API. If a source is unavailable, it skips that
 * write so the last-good data keeps serving.
 *
 * Zero external dependencies — Node 20 built-ins only (fetch, node:zlib).
 *
 * Env required:
 *   CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID, CF_API_TOKEN
 * Optional:
 *   M3U_URL, EPG_URL, APP_VERSION, MAINTENANCE ("true"/"false"), ANNOUNCEMENTS (JSON array)
 */

import { gunzipSync, gzipSync } from "node:zlib";

const ACC = requireEnv("CF_ACCOUNT_ID");
const NS = requireEnv("CF_KV_NAMESPACE_ID");
const TOKEN = requireEnv("CF_API_TOKEN");

const M3U_URL = requireEnv("M3U_URL");
const EPG_URL = requireEnv("EPG_URL");

// EPG window kept in the guide / per-channel windows.
const NOW = Date.now();
const GUIDE_START = NOW - 6 * 3600 * 1000; // 6h in the past
const GUIDE_END = NOW + 48 * 3600 * 1000; // 48h ahead
const WIN_START = NOW - 1 * 3600 * 1000; // per-channel now/next window
const WIN_END = NOW + 12 * 3600 * 1000;

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env: ${name}`);
    process.exit(1);
  }
  return v;
}

function https(u) {
  return u && u.startsWith("http://") ? "https://" + u.slice(7) : u;
}

async function fetchBytes(url) {
  const res = await fetch(https(url), {
    headers: { "User-Agent": "CharmIPTV-Builder/1.0" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // Inflate only if gzip magic bytes are present.
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) return gunzipSync(buf);
  return buf;
}

// ── M3U parsing ──────────────────────────────────────────────────────────────
function attr(line, name) {
  const m = line.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : "";
}
function parseM3U(text) {
  const lines = text.split(/\r?\n/);
  const channels = [];
  const seen = new Set();
  let pending = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("#EXTINF")) {
      const comma = line.lastIndexOf(",");
      const name = (comma !== -1 ? line.slice(comma + 1) : "").trim();
      pending = {
        name: name || attr(line, "tvg-name") || "Unknown",
        tvgId: attr(line, "tvg-id"),
        logo: https(attr(line, "tvg-logo")),
        group: attr(line, "group-title") || "Uncategorized",
      };
    } else if (line && !line.startsWith("#") && pending) {
      let id = pending.tvgId || slug(pending.name);
      let base = id;
      let n = 2;
      while (seen.has(id)) id = `${base}-${n++}`;
      seen.add(id);
      channels.push({
        id,
        tvgId: pending.tvgId || id,
        name: pending.name,
        logo: pending.logo || "",
        category: pending.group,
        url: line,
      });
      pending = null;
    }
  }
  return channels;
}
function slug(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "ch";
}

// ── XMLTV parsing (indexOf scanning — fast, no DOM) ───────────────────────────
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decode(s) {
  if (s.indexOf("&") === -1) return s;
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === "#") {
      const c = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return isNaN(c) ? m : String.fromCodePoint(c);
    }
    return ENT[e] ?? m;
  });
}
function xAttr(head, name) {
  const m = head.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : "";
}
function xTag(body, name) {
  const m = body.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1].trim()) : "";
}
function xTime(s) {
  if (!s) return null;
  const t = s.trim();
  if (t.length < 14) return null;
  const y = +t.slice(0, 4),
    mo = +t.slice(4, 6),
    d = +t.slice(6, 8),
    h = +t.slice(8, 10),
    mi = +t.slice(10, 12),
    se = +t.slice(12, 14);
  if ([y, mo, d, h, mi, se].some(isNaN)) return null;
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) {
    return null;
  }
  let ms = Date.UTC(y, mo - 1, d, h, mi, se);
  const rest = t.slice(14).trim();
  if (rest.length >= 5 && (rest[0] === "+" || rest[0] === "-")) {
    const sign = rest[0] === "-" ? -1 : 1;
    const oh = +rest.slice(1, 3),
      om = +rest.slice(3, 5);
    if (!isNaN(oh) && !isNaN(om)) ms -= sign * (oh * 60 + om) * 60000;
  }
  return isNaN(ms) ? null : ms;
}
function parseXMLTV(xml) {
  // icons by channel id
  const icons = {};
  let cp = 0;
  while (true) {
    const s = xml.indexOf("<channel", cp);
    if (s === -1) break;
    const gt = xml.indexOf(">", s);
    const e = xml.indexOf("</channel>", gt);
    if (gt === -1 || e === -1) break;
    const id = xAttr(xml.slice(s + 8, gt), "id");
    const body = xml.slice(gt + 1, e);
    cp = e + 10;
    const ii = body.indexOf("<icon");
    if (id && ii !== -1) {
      const ie = body.indexOf(">", ii);
      const src = xAttr(body.slice(ii + 5, ie), "src");
      if (src) icons[id] = https(src);
    }
  }
  // programmes by channel id (windowed)
  const byChannel = {};
  let p = 0;
  while (true) {
    const s = xml.indexOf("<programme", p);
    if (s === -1) break;
    const gt = xml.indexOf(">", s);
    const e = xml.indexOf("</programme>", gt);
    if (gt === -1 || e === -1) break;
    const head = xml.slice(s + 10, gt);
    p = e + 12;
    const cid = xAttr(head, "channel");
    const start = xTime(xAttr(head, "start"));
    if (!cid || start === null || start > GUIDE_END) continue;
    const parsedStop = xTime(xAttr(head, "stop"));
    if (parsedStop !== null && parsedStop < GUIDE_START) continue;
    const stop = parsedStop && parsedStop > start && parsedStop - start <= 24 * 3600 * 1000
      ? parsedStop
      : start + 30 * 60000;
    const body = xml.slice(gt + 1, e);
    let desc = xTag(body, "desc");
    if (desc.length > 220) desc = desc.slice(0, 217) + "…";
    (byChannel[cid] = byChannel[cid] || []).push({
      t: xTag(body, "title") || "No Title",
      s: start,
      e: stop,
      d: desc || undefined,
      c: xTag(body, "category") || undefined,
    });
  }
  for (const k in byChannel) byChannel[k].sort((a, b) => a.s - b.s);
  return { icons, byChannel };
}

// ── Cloudflare KV REST ────────────────────────────────────────────────────────
async function kvPut(key, body, contentType) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACC}/storage/kv/namespaces/${NS}/values/${encodeURIComponent(
    key,
  )}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": contentType },
    body,
  });
  if (!res.ok) throw new Error(`KV PUT ${key} failed: ${res.status} ${await res.text()}`);
  console.log(`✓ KV wrote "${key}" (${Buffer.byteLength(body)} bytes)`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log("Charm IPTV builder starting…");

  // 1) Channels (required). If this fails, abort without touching KV.
  let channels;
  try {
    const m3uText = (await fetchBytes(M3U_URL)).toString("utf8");
    channels = parseM3U(m3uText);
    if (!channels.length) throw new Error("M3U parsed to 0 channels");
    console.log(`Parsed ${channels.length} channels`);
  } catch (err) {
    console.error("M3U fetch/parse failed — keeping last-good KV data:", err.message);
    process.exit(1);
  }

  // 2) EPG (optional). On failure, still publish channels + config.
  let byChannel = null;
  let icons = {};
  try {
    const epgXml = (await fetchBytes(EPG_URL)).toString("utf8");
    ({ icons, byChannel } = parseXMLTV(epgXml));
    const progCount = Object.values(byChannel).reduce((a, v) => a + v.length, 0);
    console.log(`Parsed EPG: ${progCount} programmes across ${Object.keys(byChannel).length} channels`);
  } catch (err) {
    console.error("EPG fetch/parse failed — keeping last-good guide:", err.message);
  }

  // Backfill missing logos from EPG icons.
  for (const c of channels) if (!c.logo && icons[c.tvgId]) c.logo = icons[c.tvgId];

  // channels payload (only what the app needs)
  const channelsPayload = channels.map((c) => ({
    id: c.id,
    tvgId: c.tvgId,
    name: c.name,
    logo: c.logo || "",
    category: c.category,
    url: c.url,
  }));
  await kvPut("channels_gz", gzipSync(Buffer.from(JSON.stringify(channelsPayload))), "application/octet-stream");

  // guide + per-channel windows (only if EPG parsed)
  if (byChannel) {
    const guide = {
      updatedAt: NOW,
      channels: channels.map((c) => ({
        id: c.id,
        p: byChannel[c.tvgId] || [],
      })),
    };
    await kvPut("guide_gz", gzipSync(Buffer.from(JSON.stringify(guide))), "application/octet-stream");

    const windows = {};
    for (const c of channels) {
      const list = byChannel[c.tvgId] || [];
      const w = list
        .filter((p) => p.e > WIN_START && p.s < WIN_END)
        .map((p) => ({ t: p.t, s: p.s, e: p.e, c: p.c }));
      windows[c.id] = { n: c.name, l: c.logo || "", g: c.category, p: w };
    }
    await kvPut("windows", JSON.stringify(windows), "text/plain");
  }

  // config
  const config = {
    version: process.env.APP_VERSION || "1.0.0",
    maintenance: (process.env.MAINTENANCE || "false").toLowerCase() === "true",
    announcements: safeJson(process.env.ANNOUNCEMENTS, []),
    lastUpdated: NOW,
    channelCount: channels.length,
    guideAvailable: !!byChannel,
    ready: true,
  };
  await kvPut("config", JSON.stringify(config), "application/json");

  console.log("Charm IPTV builder finished ✔");
})().catch((e) => {
  console.error("Builder crashed:", e);
  process.exit(1);
});

function safeJson(s, fallback) {
  if (!s) return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}
