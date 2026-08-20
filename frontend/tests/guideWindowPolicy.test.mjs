import assert from "node:assert/strict";
import fs from "node:fs";

const store = fs.readFileSync(new URL("../src/store.tsx", import.meta.url), "utf8");
const native = fs.readFileSync(new URL("../android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt", import.meta.url), "utf8");
assert.match(store, /DEFAULT_GUIDE_WINDOW_HOURS = readGuideWindowHours\(process\.env\.EXPO_PUBLIC_GUIDE_WINDOW_HOURS, 12\)/);
assert.match(store, /n === 6 \|\| n === 8 \|\| n === 12 \|\| n === 24/);
assert.match(native, /GUIDE_WINDOW_MS = 24L \* 60L \* 60L \* 1000L/);
assert.doesNotMatch(native, /GUIDE_WINDOW_MS = 72L/);
console.log("guide window policy regression: ok");
