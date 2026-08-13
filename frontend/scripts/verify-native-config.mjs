import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8');
const app = JSON.parse(read('app.json')).expo;
const gradle = read('android/app/build.gradle');
const manifest = read('android/app/src/main/AndroidManifest.xml');
const activity = read('android/app/src/main/java/com/charmiptv/app/MainActivity.kt');
const remote = read('android/app/src/main/java/com/charmiptv/app/TvRemoteModule.kt');
const phaseAbPlugin = read('plugins/withTvRemotePhaseAB.js');
const remoteTemplate = read('plugins/templates/TvRemoteModule.phaseAB.kt');
const activityTemplate = read('plugins/templates/MainActivity.phaseAB.kt');
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
requireMatch(!/jsc-android:[^'"\r\n]*\+/.test(gradle), 'JavaScriptCore fallback must be pinned to an exact version');
requireMatch(app.plugins.includes('./plugins/withAndroidTv'), 'Android TV config plugin is missing');
requireMatch(app.plugins.includes('./plugins/withTvRemotePhaseAB'), 'Phase A+B TV remote wrapper is missing');
requireMatch(!app.plugins.includes('./plugins/withTvRemote'), 'Legacy TV remote plugin must not run separately from Phase A+B wrapper');
requireMatch(app.plugins.includes('./plugins/withLowMemoryAndroidBuild'), 'Android memory config plugin is missing');

for (const [name, source] of [
  ['checked-in TvRemoteModule', remote],
  ['TvRemoteModule Phase A template', remoteTemplate],
]) {
  requireMatch(source.includes('guideLogicalFocusPending'), `${name} is missing logical focus backpressure`);
  requireMatch(source.includes('guideLogicalFocusPendingSinceMs'), `${name} is missing stale-focus watchdog state`);
  requireMatch(source.includes('pendingLogicalGuideKey'), `${name} is missing held-key coalescing`);
  requireMatch(source.includes('TvGuideLogicalKey'), `${name} is missing logical Guide event emission`);
}
for (const [name, source] of [
  ['checked-in MainActivity', activity],
  ['MainActivity Phase A template', activityTemplate],
]) {
  requireMatch(source.includes('LOGICAL_FOCUS_ACK_TIMEOUT_MS'), `${name} is missing focus-ack timeout`);
  requireMatch(source.includes('guideLogicalFocusPendingSinceMs'), `${name} is missing pending-age recovery`);
  requireMatch(source.includes('pendingLogicalGuideKey = null'), `${name} does not clear stale queued input`);
}
requireMatch(phaseAbPlugin.includes('withTvRemote(config)'), 'Phase A+B wrapper must preserve base TV wiring');
requireMatch(phaseAbPlugin.includes('TvRemoteModule.phaseAB.kt'), 'Phase A+B wrapper must install remote template');
requireMatch(phaseAbPlugin.includes('MainActivity.phaseAB.kt'), 'Phase A+B wrapper must install activity template');

if (failures.length > 0) {
  for (const failure of failures) console.error(`CONFIG ERROR: ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Native config verified: ${applicationId} ${versionName} (${versionCode}) + Phase A/B remote parity`);
}
