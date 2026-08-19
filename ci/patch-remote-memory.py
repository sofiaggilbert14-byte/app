from pathlib import Path

# Native remote module: expose memory profile and emit long-press actions once.
path = Path('frontend/plugins/withTvRemote.js')
text = path.read_text()
text = text.replace('import android.media.MediaCodecList\n', 'import android.media.MediaCodecList\nimport android.app.ActivityManager\nimport android.content.Context\n', 1)
anchor = '''  @ReactMethod\n  fun setGuideRepeatInterval(milliseconds: Double) {\n    guideRepeatIntervalMs = milliseconds.toLong().coerceIn(60L, 120L)\n  }\n'''
insert = anchor + '''\n  @ReactMethod\n  fun getDeviceMemoryProfile(promise: Promise) {\n    try {\n      val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager\n      promise.resolve(Arguments.createMap().apply {\n        putInt("memoryClassMb", am.memoryClass)\n        putBoolean("lowRamDevice", if (android.os.Build.VERSION.SDK_INT >= 19) am.isLowRamDevice else am.memoryClass < 128)\n      })\n    } catch (t: Throwable) {\n      promise.reject("MEMORY_PROFILE_FAILED", t.message ?: "Memory profile unavailable", t)\n    }\n  }\n'''
if anchor not in text: raise SystemExit('memory profile anchor missing')
text = text.replace(anchor, insert, 1)
# Add long-press emitted-key guard fields to MainActivity hardening.
old = '''  private var lastAcceptedDirectionalRepeatAt = 0L\n  private var lastAcceptedDirectionalKeyCode = -1\n  private val minDpadRepeatMs = 48L\n'''
new = old + '''  private var emittedLongPressKeyCode = -1\n'''
if old not in text: raise SystemExit('remote field anchor missing')
text = text.replace(old, new, 1)
# Insert long-press event before directional throttling.
anchor = '''    val directional =\n      event.keyCode == android.view.KeyEvent.KEYCODE_DPAD_UP ||'''
insert = '''    // Emit one semantic long-press event per physical hold. Keep normal Android\n    // focus dispatch intact; JS may choose a context-specific shortcut without\n    // duplicating every repeat event across the bridge.\n    if (event.action == android.view.KeyEvent.ACTION_DOWN && event.repeatCount > 0 && emittedLongPressKeyCode != event.keyCode) {\n      val longKey = when (event.keyCode) {\n        android.view.KeyEvent.KEYCODE_DPAD_DOWN -> "DOWN"\n        android.view.KeyEvent.KEYCODE_DPAD_CENTER,\n        android.view.KeyEvent.KEYCODE_ENTER,\n        android.view.KeyEvent.KEYCODE_NUMPAD_ENTER,\n        android.view.KeyEvent.KEYCODE_BUTTON_A -> "SELECT"\n        android.view.KeyEvent.KEYCODE_BACK -> "BACK"\n        else -> null\n      }\n      if (longKey != null) {\n        emittedLongPressKeyCode = event.keyCode\n        try {\n          val app = application as com.facebook.react.ReactApplication\n          val rc = try { app.reactHost?.currentReactContext } catch (e: Throwable) { null }\n            ?: try { app.reactNativeHost.reactInstanceManager.currentReactContext } catch (e: Throwable) { null }\n          rc?.getJSModule(com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)\n            ?.emit("TvRemoteLongPress", longKey)\n        } catch (_: Throwable) {}\n      }\n    } else if (event.action == android.view.KeyEvent.ACTION_UP && event.keyCode == emittedLongPressKeyCode) {\n      emittedLongPressKeyCode = -1\n    }\n\n''' + anchor
if anchor not in text: raise SystemExit('dispatch long press anchor missing')
text = text.replace(anchor, insert, 1)
path.write_text(text)

# JS remote API additions.
path = Path('frontend/src/utils/tvRemote.ts')
text = path.read_text()
text = text.replace('export type TvKey = "UP" | "DOWN" | "LEFT" | "RIGHT" | "SELECT" | "BACK";','''export type TvKey = "UP" | "DOWN" | "LEFT" | "RIGHT" | "SELECT" | "BACK";\nexport type TvLongPressKey = "DOWN" | "SELECT" | "BACK";\nexport type DeviceMemoryProfile = { memoryClassMb: number; lowRamDevice: boolean };''',1)
anchor = '''export function addTvKeyListener(cb: (key: TvKey) => void): () => void {'''
addition = '''export function addTvLongPressListener(cb: (key: TvLongPressKey) => void): () => void {\n  const eventName = "TvRemoteLongPress";\n  if (emitter) {\n    const sub = emitter.addListener(eventName, (key: TvLongPressKey) => cb(key));\n    return () => sub.remove();\n  }\n  const sub = DeviceEventEmitter.addListener(eventName, (key: TvLongPressKey) => cb(key));\n  return () => sub.remove();\n}\n\nexport async function getDeviceMemoryProfile(): Promise<DeviceMemoryProfile | null> {\n  try {\n    if (!TvRemote?.getDeviceMemoryProfile) return null;\n    const raw = await TvRemote.getDeviceMemoryProfile();\n    return {\n      memoryClassMb: Number(raw?.memoryClassMb) || 0,\n      lowRamDevice: !!raw?.lowRamDevice,\n    };\n  } catch {\n    return null;\n  }\n}\n\n'''
if anchor not in text: raise SystemExit('tvRemote API anchor missing')
text = text.replace(anchor, addition + anchor, 1)
path.write_text(text)

# Runtime hook/profile helper.
Path('frontend/src/core/deviceMemoryProfile.ts').write_text('''import React from "react";\nimport { getDeviceMemoryProfile, type DeviceMemoryProfile } from "@/src/utils/tvRemote";\n\nlet cached: DeviceMemoryProfile | null | undefined;\nlet pending: Promise<DeviceMemoryProfile | null> | null = null;\n\nexport async function readDeviceMemoryProfile(): Promise<DeviceMemoryProfile | null> {\n  if (cached !== undefined) return cached;\n  if (!pending) pending = getDeviceMemoryProfile().then((value) => (cached = value));\n  return pending;\n}\n\nexport function useDeviceMemoryProfile(): DeviceMemoryProfile | null {\n  const [profile, setProfile] = React.useState<DeviceMemoryProfile | null>(() => cached ?? null);\n  React.useEffect(() => {\n    let active = true;\n    void readDeviceMemoryProfile().then((value) => { if (active) setProfile(value); });\n    return () => { active = false; };\n  }, []);\n  return profile;\n}\n\nexport function shouldUseLowRamTuning(profile: DeviceMemoryProfile | null): boolean {\n  if (!profile) return false;\n  return profile.lowRamDevice || (profile.memoryClassMb > 0 && profile.memoryClassMb < 192);\n}\n''')

# Guide: auto-tighten effective profile on low-RAM devices unless user already chose Compatibility.
path = Path('frontend/app/(tabs)/guide.tsx')
text = path.read_text()
anchor = 'import { getPowerProfileTuning } from "@/src/core/devicePowerProfile";\n'
if anchor not in text: raise SystemExit('guide power import missing')
text = text.replace(anchor, anchor + 'import { shouldUseLowRamTuning, useDeviceMemoryProfile } from "@/src/core/deviceMemoryProfile";\n',1)
old = '  const powerTuning = useMemo(() => getPowerProfileTuning(powerProfile), [powerProfile]);\n'
new = '''  const deviceMemoryProfile = useDeviceMemoryProfile();\n  const effectivePowerProfile = shouldUseLowRamTuning(deviceMemoryProfile) && powerProfile === "normal"\n    ? "weak"\n    : powerProfile;\n  const powerTuning = useMemo(() => getPowerProfileTuning(effectivePowerProfile), [effectivePowerProfile]);\n'''
if old not in text: raise SystemExit('guide tuning anchor missing')
text = text.replace(old,new,1)
path.write_text(text)

# Player: long Down opens channel strip; long Select reveals controls. These are existing UI actions, so no dead shortcuts.
path = Path('frontend/app/player.tsx')
text = path.read_text()
text = text.replace('import { addTvKeyListener } from "@/src/utils/tvRemote";','import { addTvKeyListener, addTvLongPressListener } from "@/src/utils/tvRemote";',1)
anchor = '''  useEffect(() => {\n    if (!isTV) return;\n    // Wake controls from hidden state only — never steal strip focus on every key.\n    return addTvKeyListener(() => {\n      if (!controlsRef.current) revealControls({ claimChannelsFocus: true });\n      else scheduleHide();\n    });\n  }, [isTV, revealControls, scheduleHide]);\n'''
addition = anchor + '''\n  useEffect(() => {\n    if (!isTV) return;\n    // TiViMate-style semantic long presses, limited to actions Charm already owns.\n    // Long Down exposes channel browsing without triggering a stream reload;\n    // Long Select simply wakes the controls/quick-action surface.\n    return addTvLongPressListener((key) => {\n      if (key === "DOWN") {\n        controlsRef.current = true;\n        setControls(true);\n        setChannelsOpen(true);\n        scheduleHide();\n        return;\n      }\n      if (key === "SELECT") revealControls({ claimChannelsFocus: true });\n    });\n  }, [isTV, revealControls, scheduleHide]);\n'''
if anchor not in text: raise SystemExit('player remote listener anchor missing')
text = text.replace(anchor, addition,1)
path.write_text(text)

# Architecture verification.
path = Path('frontend/scripts/verify-overhaul-architecture.mjs')
text = path.read_text()
checks = '''\n// Remote/focus and low-RAM architecture.\nrequireText("plugins/withTvRemote.js", "TvRemoteLongPress", "native semantic long-press routing is missing");\nrequireText("plugins/withTvRemote.js", "getDeviceMemoryProfile", "Android memory-class profiler is missing");\nrequireText("src/utils/tvRemote.ts", "addTvLongPressListener", "JS long-press remote API is missing");\nrequireText("app/player.tsx", 'key === "DOWN"', "player long-Down channel access is missing");\nrequireText("app/(tabs)/guide.tsx", "shouldUseLowRamTuning", "Guide does not auto-tighten on low-RAM devices");\n'''
if 'Android memory-class profiler is missing' not in text:
    text = text.replace('console.log("TiViMate architecture-overhaul conflict scan passed.");', checks + '\nconsole.log("TiViMate architecture-overhaul conflict scan passed.");')
path.write_text(text)
