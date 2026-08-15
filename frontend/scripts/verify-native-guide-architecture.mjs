import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFileSync(resolve(root, path), "utf8");
const guide = read("app/(tabs)/guide.tsx");
const bridge = read("src/components/NativeGuide.tsx");
const view = read("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt");
const app = read("android/app/src/main/java/com/charmiptv/app/MainApplication.kt");
const failures = [];
const require = (condition, message) => { if (!condition) failures.push(message); };

require(guide.includes("<NativeGuide"), "Guide screen must mount NativeGuide");
require(!guide.includes("<TimelineGrid") && !guide.includes("<BoxGrid"), "Guide screen must not mount React cell grids");
require(bridge.includes('requireNativeComponent<any>("CharmNativeGuide")'), "native Guide bridge is missing");
require(bridge.includes("if (!item.value.settled) return"), "preview metadata must wait for settled selection");
require(view.includes("override fun onDraw(canvas: Canvas)"), "Guide must render on one Android canvas");
require(view.includes("override fun onKeyDown"), "Guide must own synchronous logical D-pad selection");
require(view.includes("database.queryGuideWindow"), "Guide must use Charm SQLite joins");
require(view.includes("repeatCount * 2"), "Guide must expand runway with D-pad velocity");
require(app.includes("add(NativeGuidePackage())"), "native Guide package is not registered");

if (failures.length) {
  failures.forEach(message => console.error(`ARCHITECTURE ERROR: ${message}`));
  process.exitCode = 1;
} else {
  console.log("Native Guide architecture verified");
}
