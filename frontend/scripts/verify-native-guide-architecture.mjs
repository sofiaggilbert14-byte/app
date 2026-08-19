import { readFileSync, existsSync } from "node:fs";
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const guide = read("app/(tabs)/guide.tsx");
const nativeView = read("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt");
const failures = [];
const require = (value, message) => { if (!value) failures.push(message); };
require(guide.includes("<NativeGuideCanvas"), "native Guide is not mounted");
require(!guide.includes("TimelineGrid") && !guide.includes("BoxGrid"), "retired React Guide is referenced");
require(!existsSync(new URL("../src/components/TimelineGrid.tsx", import.meta.url)), "retired TimelineGrid still exists");
require(!existsSync(new URL("../src/components/BoxGrid.tsx", import.meta.url)), "retired BoxGrid still exists");
require(!existsSync(new URL("../src/utils/tvGuideFocusLock.ts", import.meta.url)), "retired focus registry still exists");
require(nativeView.includes("database.queryGuideWindow"), "native Guide is not backed by SQLite");
require(nativeView.includes("moveVelocity"), "velocity-aware runway is missing");
if (failures.length) { failures.forEach(value => console.error(`ARCHITECTURE ERROR: ${value}`)); process.exit(1); }
console.log("Native Guide architecture verified");
