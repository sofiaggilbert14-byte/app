import fs from "node:fs";

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function requireText(path, text, reason) {
  const body = read(path);
  if (!body.includes(text)) throw new Error(`${path}: ${reason} (missing ${JSON.stringify(text)})`);
}

function forbidText(path, text, reason) {
  const body = read(path);
  if (body.includes(text)) throw new Error(`${path}: ${reason} (found ${JSON.stringify(text)})`);
}

// Guide groups must have exactly one navigation surface: the drawer.
forbidText("app/(tabs)/guide.tsx", "GuideGroupChip", "legacy top group bar returned");
forbidText("app/(tabs)/guide.tsx", "moreGroupsOpen", "legacy More Groups overlay returned");
forbidText("app/(tabs)/guide.tsx", "groupLayout", "legacy horizontal/vertical group layout returned");
requireText("app/(tabs)/guide.tsx", "guideGroups={drawerGroups}", "Guide groups are not wired into the drawer");

// Android playlist ingestion must stay native/streaming.
forbidText("src/source.native.ts", "parseM3UWithStats", "Android source is parsing the full M3U in JS again");
forbidText("src/source.native.ts", "response.text()", "Android source is materializing the full M3U string again");
requireText("src/source.native.ts", "fetchNativePlaylist", "native M3U bridge is not used");
requireText("android/app/src/main/java/com/charmiptv/app/NativePlaylistParser.kt", "BufferedReader", "native M3U parser is not streaming lines");

// Broad disk retention must remain decoupled from bounded RAM acceleration.
requireText("android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt", "GUIDE_WINDOW_MS = 72L * 60L * 60L * 1000L", "SQLite EPG retention is not 72h");
requireText("src/nativeEpg.ts", "const RAM_HISTORY_MS = 6 * 60 * 60 * 1000", "RAM history bound is missing");
requireText("src/nativeEpg.ts", "const RAM_FUTURE_MS = 12 * 60 * 60 * 1000", "RAM future bound is missing");
forbidText("src/nativeEpg.ts", "ramModule.warm(result.windowStartMs, result.windowEndMs)", "72h disk window is being warmed wholesale into RAM");

// Player policy: Media3 first, VLC recovery.
requireText("src/core/streamPolicy.ts", 'return "media3";', "Media3 is no longer the default engine");
requireText("src/core/streamPolicy.ts", 'return vlcAvailable ? "vlc" : null;', "VLC fallback path is missing");

// Logo pipeline must stay bounded and pressure-reclaimable.
requireText("src/components/ChannelLogo.tsx", "MAX_CONCURRENT_IMAGE_LOADS", "logo concurrency cap is missing");
requireText("src/components/ChannelLogo.tsx", "MAX_LOAD_QUEUE", "logo load queue is not bounded");
requireText("src/components/ChannelLogo.tsx", 'cachePolicy="memory-disk"', "recent-logo RAM+disk cache is missing");
requireText("app/_layout.tsx", "LogoMemoryPressureGuard", "decoded logo RAM is not globally reclaimed under memory pressure");
requireText("src/core/epgMatching.ts", "playlist_logo", "playlist logo source is not retained");
requireText("src/core/epgMatching.ts", "epg_logo", "EPG logo source is not retained");

// User-visible refresh controls must drive independent source clocks.
requireText("app/(tabs)/settings.tsx", "Playlist auto refresh", "playlist refresh interval setting is missing");
requireText("app/(tabs)/settings.tsx", "EPG auto refresh", "EPG refresh interval setting is missing");
requireText("src/components/SourceRefreshScheduler.tsx", "refreshSourcesIfDue", "source refresh scheduler is not active");

console.log("TiViMate architecture-overhaul conflict scan passed.");
