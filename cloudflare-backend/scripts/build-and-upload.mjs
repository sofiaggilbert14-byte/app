#!/usr/bin/env node
/**
 * Charm IPTV data builder (runs on GitHub Actions every 6h).
 *
 * Downloads the M3U playlist + gzipped EPG, parses them on a full-power runner,
 * builds compact JSON, gzips the big payloads, and writes everything to
 * Cloudflare KV. The Worker only serves the finished data.
 */

import { gunzipSync, gzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";

const NOW = Date.now();
const GUIDE_WINDOW_HOURS = readGuideWindowHours(process.env.GUIDE_WINDOW_HOURS, 48);
const GUIDE_START = NOW - 6 * 3600 * 1000;
const GUIDE_END = NOW + GUIDE_WINDOW_HOURS * 3600 * 1000;
const WIN_START = NOW - 1 * 3600 * 1000;
const WIN_END = NOW + GUIDE_WINDOW_HOURS * 3600 * 1000;
const FETCH_ATTEMPTS = [
  {
    "User-Agent": "TiviMate/5.1.6 (Linux; Android TV)",
    Accept: "application/x-mpegURL,application/xml,text/xml,*/*",
  },
  {
    "User-Agent": "OTT Navigator/1.7.0 (Linux; Android)",
    Accept: "application/x-mpegURL,application/xml,text/xml,*/*",
  },
  {
    "User-Agent":
      "Mozilla/5.0 (Linux; Android 11; Android TV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    Accept: "*/*",
  },
];

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env: ${name}`);
    process.exit(1);
  }
  return v;
}

function readGuideWindowHours(value, fallback) {
  const n = Number(value || fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(72, Math.max(12, Math.round(n)));
}

function https(u) {
  return u && u.startsWith("http://") ? "https://" + u.slice(7) : u;
}

async function fetchBytes(url) {
  let lastError = null;
  for (let i = 0; i < FETCH_ATTEMPTS.length; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          ...FETCH_ATTEMPTS[i],
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
        redirect: "follow",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) return gunzipSync(buf);
      return buf;
    } catch (err) {
      lastError = err;
      if (i < FETCH_ATTEMPTS.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 750 * (i + 1)));
      }
    }
  }
  throw lastError;
}

function attr(line, name) {
  const m = line.match(new RegExp(`\\b${name}=["']([^"']*)["']`, "i"));
  return m ? m[1].trim() : "";
}

function playlistGuideUrls(line) {
  return [
    attr(line, "url-tvg"),
    attr(line, "x-tvg-url"),
    attr(line, "tvg-url"),
    attr(line, "epg-url"),
  ].filter(Boolean);
}

export function parseM3UWithMeta(text) {
  const lines = text.split(/\r?\n/);
  const channels = [];
  const epgUrls = [];
  const seen = new Set();
  let pending = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("#EXTM3U")) {
      epgUrls.push(...playlistGuideUrls(line));
      continue;
    }

    if (line.startsWith("#EXTINF")) {
      const comma = line.lastIndexOf(",");
      const name = (comma !== -1 ? line.slice(comma + 1) : "").trim();
      pending = {
        name: name || attr(line, "tvg-name") || "Unknown",
        tvgId: attr(line, "tvg-id"),
        logo: https(attr(line, "tvg-logo")),
        group: attr(line, "group-title") || "Uncategorized",
      };
      continue;
    }

    if (!line || line.startsWith("#") || !pending) continue;

    const base = pending.tvgId || slug(pending.name);
    let id = base;
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

  return { channels, epgUrls: [...new Set(epgUrls)] };
}

export function parseM3U(text) {
  return parseM3UWithMeta(text).channels;
}

function slug(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "ch";
}

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
  return m ? decode(m[1].trim()) : "";
}

function xTag(body, name) {
  const m = body.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1].trim()) : "";
}

function xTags(body, name) {
  const values = [];
  const re = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "g");
  let m;
  while ((m = re.exec(body))) values.push(decode(m[1].trim()));
  return values.filter(Boolean);
}

function xTime(s) {
  if (!s) return null;
  const t = s.trim();
  if (t.length < 14) return null;
  const y = +t.slice(0, 4);
  const mo = +t.slice(4, 6);
  const d = +t.slice(6, 8);
  const h = +t.slice(8, 10);
  const mi = +t.slice(10, 12);
  const se = +t.slice(12, 14);
  if ([y, mo, d, h, mi, se].some(isNaN)) return null;
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) {
    return null;
  }

  let ms = Date.UTC(y, mo - 1, d, h, mi, se);
  const rest = t.slice(14).trim();
  if (rest.length >= 5 && (rest[0] === "+" || rest[0] === "-")) {
    const sign = rest[0] === "-" ? -1 : 1;
    const oh = +rest.slice(1, 3);
    const om = +rest.slice(3, 5);
    if (!isNaN(oh) && !isNaN(om)) ms -= sign * (oh * 60 + om) * 60000;
  }
  return isNaN(ms) ? null : ms;
}

export function parseXMLTV(xml) {
  const icons = {};
  const channelNames = {};
  const stats = {
    declaredChannels: 0,
    rawProgrammes: 0,
    keptProgrammes: 0,
    skippedMissingChannel: 0,
    skippedBadStart: 0,
    skippedOutsideWindow: 0,
    recoveredStaleProgrammes: 0,
    staleShiftDays: 0,
    firstProgrammeHead: "",
    firstProgrammeStart: null,
    lastProgrammeStop: null,
  };
  const expiredProgrammes = [];
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

    if (!id) continue;
    stats.declaredChannels++;
    channelNames[id] = xTags(body, "display-name");
    const ii = body.indexOf("<icon");
    if (ii !== -1) {
      const ie = body.indexOf(">", ii);
      const src = ie === -1 ? "" : xAttr(body.slice(ii + 5, ie), "src");
      if (src) icons[id] = https(src);
    }
  }

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
    stats.rawProgrammes++;
    if (!stats.firstProgrammeHead) stats.firstProgrammeHead = head.trim().slice(0, 180);

    const cid = xAttr(head, "channel");
    const start = xTime(xAttr(head, "start"));
    if (!cid) {
      stats.skippedMissingChannel++;
      continue;
    }
    if (start === null) {
      stats.skippedBadStart++;
      continue;
    }
    if (stats.firstProgrammeStart === null || start < stats.firstProgrammeStart) stats.firstProgrammeStart = start;

    const parsedStop = xTime(xAttr(head, "stop"));
    if (parsedStop !== null && (stats.lastProgrammeStop === null || parsedStop > stats.lastProgrammeStop)) {
      stats.lastProgrammeStop = parsedStop;
    }
    const stop = parsedStop && parsedStop > start && parsedStop - start <= 24 * 3600 * 1000
      ? parsedStop
      : start + 30 * 60000;
    const body = xml.slice(gt + 1, e);
    let desc = xTag(body, "desc");
    if (desc.length > 220) desc = `${desc.slice(0, 217)}...`;
    const program = {
      t: xTag(body, "title") || "No Title",
      s: start,
      e: stop,
      d: desc || undefined,
      c: xTag(body, "category") || undefined,
    };

    if (start > GUIDE_END || stop < GUIDE_START) {
      stats.skippedOutsideWindow++;
      if (stop < GUIDE_START) expiredProgrammes.push({ cid, program });
      continue;
    }

    (byChannel[cid] = byChannel[cid] || []).push(program);
    stats.keptProgrammes++;
  }

  // M3U4U can occasionally serve a valid XMLTV file whose programme dates are
  // stale. For Phoenix beta, recover that data by sliding it forward by whole
  // days so the guide remains usable while still only showing playlist channels.
  if (stats.keptProgrammes === 0 && expiredProgrammes.length && stats.lastProgrammeStop !== null && stats.lastProgrammeStop < GUIDE_START) {
    const dayMs = 24 * 3600 * 1000;
    const shiftDays = Math.max(1, Math.ceil((GUIDE_START - stats.lastProgrammeStop) / dayMs));
    const shiftMs = shiftDays * dayMs;
    stats.staleShiftDays = shiftDays;

    for (const { cid, program } of expiredProgrammes) {
      const shifted = {
        ...program,
        s: program.s + shiftMs,
        e: program.e + shiftMs,
      };
      if (shifted.e > GUIDE_START && shifted.s < GUIDE_END) {
        (byChannel[cid] = byChannel[cid] || []).push(shifted);
        stats.recoveredStaleProgrammes++;
      }
    }
    stats.keptProgrammes = stats.recoveredStaleProgrammes;
  }

  for (const k in byChannel) byChannel[k].sort((a, b) => a.s - b.s);
  return { icons, byChannel, channelNames, stats };
}

function stripSourceSuffix(value) {
  return (value || "")
    .replace(/\s*\((m3u4u|src\d+|source\d+)\)\s*$/i, "")
    .replace(/[#-](m3u4u|src\d+|source\d+)$/i, "")
    .trim();
}

function normalizedKey(value) {
  const stripped = stripSourceSuffix(decode(String(value || "")));
  return stripped
    .toLowerCase()
    .replace(/\b(vip|fhd|uhd|hd|sd|live)\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function candidateKeys(...values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const raw = String(value || "").trim();
    const stripped = stripSourceSuffix(raw);
    const colonParts = stripped
      .split(":")
      .map((part) => part.trim())
      .filter(Boolean);
    const afterColon = colonParts.length > 1 ? colonParts[colonParts.length - 1] : "";
    const dashParts = stripped
      .split(/\s+-\s+/)
      .map((part) => part.trim())
      .filter(Boolean);
    const afterDash = dashParts.length > 1 ? dashParts[dashParts.length - 1] : "";
    for (const item of [
      raw,
      stripped,
      afterColon,
      afterDash,
      normalizedKey(raw),
      normalizedKey(stripped),
      normalizedKey(afterColon),
      normalizedKey(afterDash),
    ]) {
      if (item && !seen.has(item)) {
        seen.add(item);
        out.push(item);
      }
    }
  }
  return out;
}

function addUnique(map, key, value) {
  if (!key) return;
  if (!map.has(key)) {
    map.set(key, value);
    return;
  }
  if (map.get(key) !== value) map.set(key, null);
}

function buildEpgIndex(byChannel, channelNames) {
  const exact = new Map();
  const fuzzy = new Map();
  for (const id of Object.keys(byChannel)) {
    exact.set(id, id);
    for (const key of candidateKeys(id)) {
      addUnique(fuzzy, normalizedKey(key), id);
    }
    for (const name of channelNames[id] || []) {
      for (const key of candidateKeys(name)) {
        addUnique(fuzzy, normalizedKey(key), id);
      }
    }
  }
  return { exact, fuzzy };
}

function sampleList(items, mapper, limit = 8) {
  return items
    .slice(0, limit)
    .map(mapper)
    .filter(Boolean)
    .join(" | ");
}

function describeProgramRange(byChannel) {
  let first = Infinity;
  let last = 0;
  for (const programs of Object.values(byChannel)) {
    for (const program of programs) {
      if (program.s < first) first = program.s;
      if (program.e > last) last = program.e;
    }
  }
  if (!Number.isFinite(first) || !last) return "none";
  return `${new Date(first).toISOString()} -> ${new Date(last).toISOString()}`;
}

function summarizeEpg(epg, label, epgXml = "") {
  const progCount = Object.values(epg.byChannel).reduce((a, v) => a + v.length, 0);
  console.log(`Parsed EPG (${label}): ${progCount} programmes across ${Object.keys(epg.byChannel).length} channels`);
  if (epg.stats) {
    console.log(
      `EPG parser stats (${label}): declaredChannels=${epg.stats.declaredChannels} rawProgrammes=${epg.stats.rawProgrammes} kept=${epg.stats.keptProgrammes} outsideWindow=${epg.stats.skippedOutsideWindow} recoveredStale=${epg.stats.recoveredStaleProgrammes} staleShiftDays=${epg.stats.staleShiftDays} badStart=${epg.stats.skippedBadStart} missingChannel=${epg.stats.skippedMissingChannel}`,
    );
    console.log(
      `EPG raw time range (${label}): ${
        epg.stats.firstProgrammeStart === null ? "none" : new Date(epg.stats.firstProgrammeStart).toISOString()
      } -> ${epg.stats.lastProgrammeStop === null ? "none" : new Date(epg.stats.lastProgrammeStop).toISOString()}`,
    );
    if (epg.stats.firstProgrammeHead) {
      console.log(`EPG first programme head (${label}): ${epg.stats.firstProgrammeHead}`);
    }
  }
  if (progCount === 0 && epgXml) {
    console.log(`EPG response sample (${label}): ${epgXml.slice(0, 200).replace(/\s+/g, " ").trim() || "(empty)"}`);
  }
  console.log(`EPG program time range (${label}): ${describeProgramRange(epg.byChannel)}`);
  console.log(
    `EPG channel samples (${label}): ${sampleList(Object.keys(epg.byChannel), (id) => {
      const names = epg.channelNames[id] || [];
      return `${id} [names=${names.slice(0, 2).join(" / ") || "-"}]`;
    })}`,
  );
  return progCount;
}

async function fetchAndParseEpg(url, label) {
  const epgXml = (await fetchBytes(url)).toString("utf8");
  const epg = parseXMLTV(epgXml);
  const progCount = summarizeEpg(epg, label, epgXml);
  return { epg, progCount };
}

function resolveEpgId(channel, epgIndex) {
  for (const key of [channel.tvgId, channel.id, channel.name, stripSourceSuffix(channel.tvgId), stripSourceSuffix(channel.name)]) {
    if (key && epgIndex.exact.has(key)) return epgIndex.exact.get(key);
  }
  for (const key of candidateKeys(channel.tvgId, channel.id, channel.name)) {
    const match = epgIndex.fuzzy.get(normalizedKey(key));
    if (match) return match;
  }
  return null;
}

export function buildGuideData(channels, epg) {
  const epgIndex = buildEpgIndex(epg.byChannel, epg.channelNames || {});
  const matches = new Map();
  for (const channel of channels) {
    matches.set(channel.id, resolveEpgId(channel, epgIndex));
  }

  const guideChannels = channels.map((channel) => {
    const epgId = matches.get(channel.id);
    return {
      id: channel.id,
      p: epgId ? epg.byChannel[epgId] || [] : [],
    };
  });

  const channelsWithGuide = guideChannels.filter((channel) => channel.p.length > 0).length;
  const unmatchedSamples = channels
    .filter((channel) => !(matches.get(channel.id) && epg.byChannel[matches.get(channel.id)]?.length))
    .slice(0, 15)
    .map((channel) => ({ id: channel.id, tvgId: channel.tvgId, name: channel.name }));

  return { guideChannels, matches, channelsWithGuide, unmatchedSamples };
}

async function kvPut(acc, ns, token, key, body, contentType) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${acc}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(
    key,
  )}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body,
  });
  if (!res.ok) throw new Error(`KV PUT ${key} failed: ${res.status} ${await res.text()}`);
  console.log(`KV wrote "${key}" (${Buffer.byteLength(body)} bytes)`);
}

export async function main() {
  const acc = requireEnv("CF_ACCOUNT_ID");
  const ns = requireEnv("CF_KV_NAMESPACE_ID");
  const token = requireEnv("CF_API_TOKEN");
  const m3uUrl = requireEnv("M3U_URL");
  const fallbackEpgUrl = process.env.EPG_URL || "";

  console.log("Charm IPTV builder starting...");
  console.log(`Guide window hours: ${GUIDE_WINDOW_HOURS}`);

  let channels;
  let embeddedEpgUrls = [];
  try {
    const m3uText = (await fetchBytes(m3uUrl)).toString("utf8");
    const playlist = parseM3UWithMeta(m3uText);
    channels = playlist.channels;
    embeddedEpgUrls = playlist.epgUrls;
    if (!channels.length) throw new Error("M3U parsed to 0 channels");
    console.log(`Parsed ${channels.length} channels`);
    if (embeddedEpgUrls.length) {
      console.log(`Found ${embeddedEpgUrls.length} embedded EPG URL(s) in playlist`);
    } else {
      console.log("Found 0 embedded EPG URLs in playlist");
    }
    console.log(
      `Playlist samples: ${sampleList(channels, (c) => `${c.name} [id=${c.id || "-"} tvgId=${c.tvgId || "-"}]`)}`,
    );
  } catch (err) {
    console.error("M3U fetch/parse failed - keeping last-good KV data:", err.message);
    console.log("::warning::Playlist source was unavailable during refresh; Cloudflare will keep serving the last-good data.");
    return;
  }

  let epg = null;
  const epgSources = [
    ...embeddedEpgUrls.map((url, index) => ({ url, label: `playlist embedded #${index + 1}` })),
    ...(fallbackEpgUrl ? [{ url: fallbackEpgUrl, label: "EPG_URL secret fallback" }] : []),
  ];
  if (!epgSources.length) {
    console.error("No EPG source found: playlist has no embedded EPG URL and EPG_URL is not configured");
  }
  for (const source of epgSources) {
    try {
      const result = await fetchAndParseEpg(source.url, source.label);
      if (result.progCount > 0) {
        epg = result.epg;
        console.log(`Using EPG source: ${source.label}`);
        break;
      }
      console.log(`Skipping EPG source with no current programmes: ${source.label}`);
    } catch (err) {
      console.error(`EPG fetch/parse failed for ${source.label}:`, err.message);
    }
  }
  if (!epg) {
    console.error("No usable current EPG data found - keeping last-good guide/windows in KV");
  }

  let channelsWithGuide = 0;
  let unmatchedSamples = [];

  if (epg) {
    const epgIndex = buildEpgIndex(epg.byChannel, epg.channelNames);
    for (const channel of channels) {
      const epgId = resolveEpgId(channel, epgIndex);
      if (!channel.logo && epgId && epg.icons[epgId]) channel.logo = epg.icons[epgId];
    }
  }

  const channelsPayload = channels.map((c) => ({
    id: c.id,
    tvgId: c.tvgId,
    name: c.name,
    logo: c.logo || "",
    category: c.category,
    url: c.url,
  }));
  await kvPut(acc, ns, token, "channels_gz", gzipSync(Buffer.from(JSON.stringify(channelsPayload))), "application/octet-stream");

  if (epg) {
    const guideData = buildGuideData(channels, epg);
    channelsWithGuide = guideData.channelsWithGuide;
    unmatchedSamples = guideData.unmatchedSamples;

    console.log(`Matched EPG: ${channelsWithGuide}/${channels.length} channels with programs`);
    if (unmatchedSamples.length) {
      console.log(`Unmatched channel samples: ${unmatchedSamples.map((c) => c.name).join(", ")}`);
    }

    const guide = {
      updatedAt: NOW,
      channels: guideData.guideChannels,
    };
    await kvPut(acc, ns, token, "guide_gz", gzipSync(Buffer.from(JSON.stringify(guide))), "application/octet-stream");

    const windows = {};
    for (const c of channels) {
      const epgId = guideData.matches.get(c.id);
      const list = epgId ? epg.byChannel[epgId] || [] : [];
      const w = list
        .filter((p) => p.e > WIN_START && p.s < WIN_END)
        .map((p) => ({ t: p.t, s: p.s, e: p.e, c: p.c }));
      windows[c.id] = { n: c.name, l: c.logo || "", g: c.category, p: w };
    }
    await kvPut(acc, ns, token, "windows", JSON.stringify(windows), "text/plain");
  }

  const config = {
    version: process.env.APP_VERSION || "1.0.0",
    maintenance: (process.env.MAINTENANCE || "false").toLowerCase() === "true",
    announcements: safeJson(process.env.ANNOUNCEMENTS, []),
    lastUpdated: NOW,
    channelCount: channels.length,
    channelsWithGuide,
    guideWindowHours: GUIDE_WINDOW_HOURS,
    guideAvailable: !!epg,
    ready: true,
  };
  await kvPut(acc, ns, token, "config", JSON.stringify(config), "application/json");

  console.log("Charm IPTV builder finished");
}

function safeJson(s, fallback) {
  if (!s) return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error("Builder crashed:", e);
    process.exit(1);
  });
}
