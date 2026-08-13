import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8');
const app = JSON.parse(read('app.json')).expo;
const gradle = read('android/app/build.gradle');
const manifest = read('android/app/src/main/AndroidManifest.xml');
const mainActivity = read('android/app/src/main/java/com/charmiptv/app/MainActivity.kt');
const guideSafeTemplate = read('plugins/templates/MainActivity.guideSafe.kt');
const guideSafePlugin = read('plugins/withTvRemoteGuideSafe.js');
const failures = [];

function requireMatch(condition, message) {
  if (!condition) failures.push(message);
}

const applicationId = gradle.match(/applicationId\s+['"]([^'"]+)['"]/)?.[1];
const versionCode = Number(gradle.match(/versionCode\s+(\d+)/)?.[1]);
const versionName = gradle.match(/versionName\s+['"]([^'"]+)['"]/)?.[1];
const buildProperties = app.plugins.find(
  (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties',
)?.[1]?.android;

requireMatch(applicationId === app.android.package, 'app.json package must match Gradle applicationId');
requireMatch(versionCode === app.android.versionCode, 'app.json versionCode must match Gradle versionCode');
requireMatch(versionName === app.version, 'app.json version must match Gradle versionName');
requireMatch(
  manifest.includes('android:usesCleartextTraffic="${allowCleartextStreams}"'),
  'AndroidManifest must use the allowCleartextStreams build placeholder',
);
requireMatch(buildProperties?.usesCleartextTraffic === false, 'Expo production config must default to HTTPS-only');
requireMatch(
  /defaultConfig\s*\{[\s\S]*?manifestPlaceholders\s*=\s*\[allowCleartextStreams:\s*['"]false['"]\]/.test(gradle),
  'Gradle defaultConfig must disable cleartext traffic',
);
requireMatch(
  /sideload\s*\{[\s\S]*?manifestPlaceholders\.allowCleartextStreams\s*=\s*['"]true['"]/.test(gradle),
  'Sideload builds must explicitly opt in to provider HTTP compatibility',
);
requireMatch(
  !/jsc-android:[^'"\r\n]*\+/.test(gradle),
  'JavaScriptCore fallback must be pinned to an exact version',
);
requireMatch(app.plugins.includes('./plugins/withAndroidTv'), 'Android TV config plugin is missing');
requireMatch(app.plugins.includes('./plugins/withTvRemoteGuideSafe'), 'Guide-safe TV remote config plugin is missing');
requireMatch(!app.plugins.includes('./plugins/withTvRemote'), 'Legacy TV remote plugin must not also run separately');
requireMatch(app.plugins.includes('./plugins/withLowMemoryAndroidBuild'), 'Android memory config plugin is missing');
requireMatch(guideSafePlugin.includes('withTvRemote(config)'), 'Guide-safe wrapper must retain established TV remote configuration');
requireMatch(guideSafePlugin.includes('MainActivity.guideSafe.kt'), 'Guide-safe wrapper must install the pinned MainActivity template');
requireMatch(mainActivity === guideSafeTemplate, 'Checked-in MainActivity must match the Guide-safe prebuild template exactly');
for (const source of [mainActivity, guideSafeTemplate]) {
  requireMatch(source.includes('hasSafeGuideVerticalTarget'), 'Guide-safe MainActivity must reject stale vertical targets');
  requireMatch(source.includes('source.focusSearch(direction)'), 'Guide-safe MainActivity must inspect Android focusSearch before held vertical repeats');
  requireMatch(source.includes('horizontalJump <= max(240f, screenWidth * 0.42f)'), 'Guide-safe MainActivity must bound sideways jumps during vertical surfing');
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`CONFIG ERROR: ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Native config verified: ${applicationId} ${versionName} (${versionCode})`);
}
