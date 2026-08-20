import assert from "node:assert/strict";
import fs from "node:fs";

const nativeBridge = fs.readFileSync(new URL("../src/nativeEpg.ts", import.meta.url), "utf8");
const source = fs.readFileSync(new URL("../src/source.native.ts", import.meta.url), "utf8");

assert.match(nativeBridge, /PLAYLIST_FETCH_TIMEOUT_MS = 45_000/);
assert.match(nativeBridge, /fetch\(cleanUrl/);
assert.match(nativeBridge, /parseM3UWithStats/);
assert.match(nativeBridge, /enforcePlaylistByteLimit/);
assert.match(nativeBridge, /enforcePlaylistTextLimit/);
assert.match(nativeBridge, /Playlist request timed out before channels could be loaded/);
assert.doesNotMatch(nativeBridge, /return nativeModule\.fetchPlaylist\(url\)/);
assert.match(source, /sourceUrl\(SOURCE_M3U\)/);
assert.match(source, /Preserve provider protocol exactly/);

console.log("startup playlist acquisition regression: ok");
