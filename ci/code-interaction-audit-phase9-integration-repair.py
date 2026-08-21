from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding="utf-8")


def once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"missing repair anchor: {label}")
    return text.replace(old, new, 1)


# 1) Guide groups/tabs: same bounded TV focus corridor used by EPG Settings.
path = "frontend/app/group-settings.tsx"
s = read(path)
s = once(s,
    'import React, { useCallback, useEffect, useMemo, useState } from "react";',
    'import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";',
    "group settings useRef")
s = once(s,
    'import { PurpleTvShell } from "@/src/components/PurpleTvShell";\n',
    'import { PurpleTvShell } from "@/src/components/PurpleTvShell";\nimport { FocusGuide } from "@/src/components/TVFocusGuideView";\n',
    "group settings FocusGuide")
s = once(s,
    '  const [preferBackFocus, setPreferBackFocus] = useState(true);\n\n  useEffect(() => {\n    const timer = setTimeout(() => setPreferBackFocus(false), 180);\n    return () => clearTimeout(timer);\n  }, []);',
    '  const [preferBackFocus, setPreferBackFocus] = useState(true);\n  const scrollRef = useRef<ScrollView | null>(null);\n\n  useEffect(() => {\n    const topTimer = setTimeout(() => scrollRef.current?.scrollTo({ y: 0, animated: false }), 0);\n    const focusTimer = setTimeout(() => setPreferBackFocus(false), 180);\n    return () => { clearTimeout(topTimer); clearTimeout(focusTimer); };\n  }, []);',
    "group settings focus lifecycle")
s = once(s,
    '        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>',
    '        <FocusGuide autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={styles.scrollWrap}>\n          <ScrollView ref={scrollRef} scrollEnabled nestedScrollEnabled showsVerticalScrollIndicator={false} contentInsetAdjustmentBehavior="never" contentContainerStyle={styles.content}>',
    "group settings scroll opening")
s = once(s,
    '        </ScrollView>\n      </View>\n    </PurpleTvShell>',
    '          </ScrollView>\n        </FocusGuide>\n      </View>\n    </PurpleTvShell>',
    "group settings scroll closing")
s = once(s,
    '  content: { gap: 12, paddingBottom: 40 },',
    '  scrollWrap: { flex: 1 },\n  content: { gap: 12, paddingBottom: 40 },',
    "group settings scroll style")
write(path, s)

# 2) Additional EPG editor: deterministic top focus + trapped scrolling corridor.
path = "frontend/app/epg-source.tsx"
s = read(path)
s = once(s,
    'import { PurpleTvShell } from "@/src/components/PurpleTvShell";\n',
    'import { PurpleTvShell } from "@/src/components/PurpleTvShell";\nimport { FocusGuide } from "@/src/components/TVFocusGuideView";\n',
    "EPG source FocusGuide")
s = once(s,
    '  const queryGeneration = useRef(0);\n\n  useEffect(() => { if (saved) setDraft(saved); }, [saved]);',
    '  const queryGeneration = useRef(0);\n  const scrollRef = useRef<ScrollView | null>(null);\n  const [preferBackFocus, setPreferBackFocus] = useState(true);\n\n  useEffect(() => { if (saved) setDraft(saved); }, [saved]);\n  useEffect(() => {\n    const topTimer = setTimeout(() => scrollRef.current?.scrollTo({ y: 0, animated: false }), 0);\n    const focusTimer = setTimeout(() => setPreferBackFocus(false), 180);\n    return () => { clearTimeout(topTimer); clearTimeout(focusTimer); };\n  }, []);',
    "EPG source focus lifecycle")
s = once(s,
    '<View style={styles.header}><Text style={styles.title}>Saved EPG source</Text><Pressable onPress={() => router.replace("/epg-sources" as any)} style={({ focused }: any) => [styles.button, focused && styles.focused]}><Text style={styles.text}>Back</Text></Pressable></View>\n    <ScrollView contentContainerStyle={styles.content}>',
    '<View style={styles.header}><Text style={styles.title}>Saved EPG source</Text><Pressable hasTVPreferredFocus={preferBackFocus} onFocus={() => setPreferBackFocus(false)} onPress={() => router.replace("/epg-sources" as any)} style={({ focused }: any) => [styles.button, focused && styles.focused]}><Text style={styles.text}>Back</Text></Pressable></View>\n    <FocusGuide autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={styles.scrollWrap}>\n      <ScrollView ref={scrollRef} scrollEnabled nestedScrollEnabled showsVerticalScrollIndicator={false} contentInsetAdjustmentBehavior="never" contentContainerStyle={styles.content}>',
    "EPG source scroll opening")
s = once(s,
    '    </ScrollView>\n  </View></PurpleTvShell>;',
    '      </ScrollView>\n    </FocusGuide>\n  </View></PurpleTvShell>;',
    "EPG source scroll closing")
s = once(s,
    'const styles = StyleSheet.create({ page:{flex:1,backgroundColor:tvColors.canvas,padding:18},header:',
    'const styles = StyleSheet.create({ page:{flex:1,backgroundColor:tvColors.canvas,padding:18},scrollWrap:{flex:1},header:',
    "EPG source scroll style")
write(path, s)

# 3) Native Guide: in live-follow mode roll the logical source window with wall
# clock while leaving manual browsing frozen. Program X coordinates still start
# at channelWidth, so the left channel rail never translates with time.
path = "frontend/android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt"
s = read(path)
s = once(s,
    '  private val horizontalPrefetchAfterMs = 60L * 60_000L\n',
    '  private val horizontalPrefetchAfterMs = 60L * 60_000L\n  private val liveWindowHistoryMs = 60L * 60_000L\n  private val liveWindowAdvanceThresholdMs = 60_000L\n',
    "native rolling-window constants")
s = once(s,
    '  private fun advanceLiveViewport(now: Long) {\n    if (!enabled || !liveFollowEnabled || windowEndMs <= windowStartMs) return\n    val liveTime = now.coerceIn(windowStartMs, windowEndMs - 1)\n    val desiredStart = clampViewportStart(liveTime - 15L * 60_000L)',
    '  private fun advanceLiveViewport(now: Long) {\n    if (!enabled || !liveFollowEnabled || windowEndMs <= windowStartMs) return\n    val configuredWindowMs = max(visibleWindowMs, windowEndMs - windowStartMs)\n    val rollingStart = now - liveWindowHistoryMs\n    if (rollingStart >= windowStartMs + liveWindowAdvanceThresholdMs) {\n      windowStartMs = rollingStart\n      windowEndMs = rollingStart + configuredWindowMs\n    }\n    val liveTime = now.coerceIn(windowStartMs, windowEndMs - 1)\n    val desiredStart = clampViewportStart(liveTime - 15L * 60_000L)',
    "native live timeline roll")
write(path, s)

# 4) Comprehensive scanner: customization focus, rolling time, fixed rail become
# release blockers alongside all existing Settings/decoder/RAM ownership checks.
path = "ci/code-interaction-audit-settings-lifecycle-scan.py"
s = read(path)
s = once(s,
    'stream = read("src/components/StreamPlayer.tsx")\n',
    'stream = read("src/components/StreamPlayer.tsx")\nnative_guide = read("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt")\n',
    "settings scanner native guide input")
insert = '''\n# Every long Phase 9 customization surface uses one bounded Android-TV focus\n# corridor. The Back row gets deterministic initial focus and ScrollView owns\n# vertical traversal rather than letting Android focus escape off-screen.\nfor name, source in (("Custom EPG", epg_custom), ("additional EPG", epg_source), ("Guide groups/tabs", groups)):\n    for required in ("FocusGuide", "trapFocusUp", "trapFocusDown", "trapFocusLeft", "trapFocusRight", "scrollRef", "nestedScrollEnabled", 'contentInsetAdjustmentBehavior="never"'):\n        if required not in source:\n            critical.append(f"{name} TV focus/scroll containment missing: {required}")\n\n# TiViMate-style live Guide behavior: expired time keeps sliding left while the\n# channel-name rail remains a fixed canvas region. Manual horizontal browsing\n# still disables live follow, so users can inspect past/future programs.\nfor required in ("liveWindowHistoryMs", "liveWindowAdvanceThresholdMs", "val rollingStart = now - liveWindowHistoryMs", "windowStartMs = rollingStart", "windowEndMs = rollingStart + configuredWindowMs"):\n    if required not in native_guide:\n        critical.append(f"native Guide rolling live window missing: {required}")\nfor required in ("liveFollowEnabled = false", "return channelWidth +", "canvas.drawRect(0f, top, channelWidth", "canvas.drawRect(channelWidth, top, width.toFloat()"):\n    if required not in native_guide:\n        critical.append(f"native Guide fixed-rail/manual-browse invariant missing: {required}")\n'''
anchor = '# Fullscreen Quick Actions is an OSD owner, not a provider-refresh owner.'
if insert.strip() not in s:
    if anchor not in s:
        raise SystemExit("settings scanner integration anchor missing")
    s = s.replace(anchor, insert + '\n' + anchor, 1)
write(path, s)

# 5) Tests: static contracts catch future regressions in TV focus and live clock.
path = "frontend/tests/groupTabsScreenFit.test.mjs"
s = read(path)
focus_test = '''\n\ntest("Phase 9 customization screens keep TV focus inside their scroll viewport", async () => {\n  const screens = await Promise.all([\n    text("app/epg-custom.tsx"),\n    text("app/epg-source.tsx"),\n    text("app/group-settings.tsx"),\n  ]);\n  for (const screen of screens) {\n    assert.match(screen, /FocusGuide/);\n    assert.match(screen, /trapFocusUp/);\n    assert.match(screen, /trapFocusDown/);\n    assert.match(screen, /trapFocusLeft/);\n    assert.match(screen, /trapFocusRight/);\n    assert.match(screen, /scrollRef/);\n    assert.match(screen, /nestedScrollEnabled/);\n    assert.match(screen, /contentInsetAdjustmentBehavior="never"/);\n  }\n});\n'''
if 'Phase 9 customization screens keep TV focus inside their scroll viewport' not in s:
    s += focus_test
write(path, s)

path = "frontend/tests/guideLiveClock.test.mjs"
s = read(path)
clock_test = '''\n\ntest("native Guide rolls live time indefinitely while channel rail stays fixed", async () => {\n  const native = await text("android/app/src/main/java/com/charmiptv/app/NativeGuideView.kt");\n  assert.match(native, /liveWindowHistoryMs/);\n  assert.match(native, /val rollingStart = now - liveWindowHistoryMs/);\n  assert.match(native, /windowStartMs = rollingStart/);\n  assert.match(native, /windowEndMs = rollingStart \+ configuredWindowMs/);\n  assert.match(native, /liveFollowEnabled = false/);\n  assert.match(native, /return channelWidth \+/);\n  assert.match(native, /canvas\.drawRect\(0f, top, channelWidth/);\n  assert.match(native, /canvas\.drawRect\(channelWidth, top, width\.toFloat\(\)/);\n});\n'''
if 'native Guide rolls live time indefinitely while channel rail stays fixed' not in s:
    s += clock_test
write(path, s)

# 6) Final APK gate now executes the entire interaction/settings audit, not only
# the two decoder lifecycle scans.
path = ".github/workflows/code-interaction-audit-final-sideload.yml"
s = read(path)
audit_step = '''      - name: Full Settings Guide EPG focus lifecycle audit\n        id: full_audit\n        continue-on-error: true\n        shell: bash\n        run: |\n          set -euo pipefail\n          python ci/code-interaction-audit-repair-idempotence-scan.py\n          python ci/code-interaction-audit-settings-lifecycle-scan.py\n          python ci/code-interaction-audit-setting-option-inventory.py\n          python ci/code-interaction-audit-epg-schedule-lifecycle-scan.py\n          python ci/code-interaction-audit-osd-lifecycle-scan.py\n          python ci/code-interaction-audit-foreground-refresh-scan.py\n          python ci/code-interaction-audit-guide-modal-lifecycle-scan.py\n          python ci/code-interaction-audit-tab-lifecycle-scan.py\n\n'''
anchor = '      - name: Whole-app lifecycle scan\n'
if 'id: full_audit' not in s:
    if anchor not in s:
        raise SystemExit("final workflow full audit anchor missing")
    s = s.replace(anchor, audit_step + anchor, 1)
s = once(s,
    '          PREVIEW_LIFECYCLE: ${{ steps.preview_lifecycle.outcome }}\n',
    '          PREVIEW_LIFECYCLE: ${{ steps.preview_lifecycle.outcome }}\n          FULL_AUDIT: ${{ steps.full_audit.outcome }}\n',
    "preflight full audit env")
s = once(s,
    '          preview_lifecycle=${PREVIEW_LIFECYCLE}\n',
    '          preview_lifecycle=${PREVIEW_LIFECYCLE}\n          full_audit=${FULL_AUDIT}\n',
    "preflight full audit status")
s = once(s,
    '            "config:${CONFIG}" "sdk:${SDK}" "lifecycle:${LIFECYCLE}" "preview_lifecycle:${PREVIEW_LIFECYCLE}" \\\n',
    '            "config:${CONFIG}" "sdk:${SDK}" "lifecycle:${LIFECYCLE}" "preview_lifecycle:${PREVIEW_LIFECYCLE}" "full_audit:${FULL_AUDIT}" \\\n',
    "preflight full audit enforcement")
s = once(s,
    '          cp ci/code-interaction-audit-preview-lifecycle-report.txt "$OUT/PREVIEW_PLAYER_SCAN.txt" 2>/dev/null || true\n',
    '          cp ci/code-interaction-audit-preview-lifecycle-report.txt "$OUT/PREVIEW_PLAYER_SCAN.txt" 2>/dev/null || true\n          cp ci/code-interaction-audit-settings-lifecycle-report.txt "$OUT/SETTINGS_INTEGRATION_SCAN.txt" 2>/dev/null || true\n',
    "preflight settings report")
s = once(s,
    '          cp ../ci/code-interaction-audit-preview-lifecycle-report.txt "$OUTDIR/PREVIEW_PLAYER_SCAN.txt"\n',
    '          cp ../ci/code-interaction-audit-preview-lifecycle-report.txt "$OUTDIR/PREVIEW_PLAYER_SCAN.txt"\n          cp ../ci/code-interaction-audit-settings-lifecycle-report.txt "$OUTDIR/SETTINGS_INTEGRATION_SCAN.txt"\n',
    "artifact settings report")
write(path, s)

# Existing Custom EPG screen must already have the same corridor; fail instead
# of silently replacing the prior direct fix.
custom = read("frontend/app/epg-custom.tsx")
for required in ("FocusGuide", "scrollRef", "nestedScrollEnabled", 'contentInsetAdjustmentBehavior="never"'):
    if required not in custom:
        raise SystemExit(f"Custom EPG prerequisite missing: {required}")

print("Phase 9 customization, live Guide, and final-gate repair applied")
