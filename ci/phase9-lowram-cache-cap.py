from pathlib import Path

path = Path('frontend/src/store.tsx')
text = path.read_text()

old_import = '''import { getPowerProfileTuning, resolvePowerProfile, type PowerProfile } from "@/src/core/devicePowerProfile";\n'''
new_import = '''import {\n  getPowerProfileTuning,\n  resolvePowerProfile,\n  setDeviceLowRamCacheCap,\n  type PowerProfile,\n} from "@/src/core/devicePowerProfile";\n'''
if old_import not in text:
    raise SystemExit('devicePowerProfile import anchor missing')
text = text.replace(old_import, new_import, 1)

old_setter = '''  const setPowerProfile = useCallback((v: PowerProfile) => {\n    const next = resolvePowerProfile(v);\n    setPowerProfileState(next);\n    storage.setItem(POWER_PROFILE_KEY, next);\n    const tuning = getPowerProfileTuning(next);\n    void readDeviceMemoryProfile().then((memory) => {\n      setChannelLogoMemoryProfile(next === "weak" || shouldUseLowRamTuning(memory), memory?.logoMemoryBytes);\n    });\n    setLogosOffWhileSurfingState(tuning.logosOffWhileSurfingDefault);\n    storage.setItem(LOGOS_OFF_SURF_KEY, tuning.logosOffWhileSurfingDefault);\n  }, []);\n'''
new_setter = '''  const setPowerProfile = useCallback((v: PowerProfile) => {\n    const next = resolvePowerProfile(v);\n    setPowerProfileState(next);\n    storage.setItem(POWER_PROFILE_KEY, next);\n    const visualTuning = getPowerProfileTuning(next);\n    void readDeviceMemoryProfile().then((memory) => {\n      const lowRam = shouldUseLowRamTuning(memory);\n      setDeviceLowRamCacheCap(lowRam);\n      const memorySafeTuning = getPowerProfileTuning(next);\n      setGuideProgramRowLimit(memorySafeTuning.programmeRowCacheLimit);\n      setProgrammeWindowCacheLimit(memorySafeTuning.programmeRowCacheLimit);\n      setChannelLogoMemoryProfile(next === "weak" || lowRam, memory?.logoMemoryBytes);\n    });\n    setLogosOffWhileSurfingState(visualTuning.logosOffWhileSurfingDefault);\n    storage.setItem(LOGOS_OFF_SURF_KEY, visualTuning.logosOffWhileSurfingDefault);\n  }, []);\n'''
if old_setter not in text:
    raise SystemExit('setPowerProfile anchor missing')
text = text.replace(old_setter, new_setter, 1)

old_init = '''      const deviceMemory = await readDeviceMemoryProfile();\n      setChannelLogoMemoryProfile(\n        profile === "weak" || shouldUseLowRamTuning(deviceMemory),\n        deviceMemory?.logoMemoryBytes,\n      );\n'''
new_init = '''      const deviceMemory = await readDeviceMemoryProfile();\n      const lowRamDevice = shouldUseLowRamTuning(deviceMemory);\n      setDeviceLowRamCacheCap(lowRamDevice);\n      const memorySafeTuning = getPowerProfileTuning(profile);\n      setGuideProgramRowLimit(memorySafeTuning.programmeRowCacheLimit);\n      setProgrammeWindowCacheLimit(memorySafeTuning.programmeRowCacheLimit);\n      setChannelLogoMemoryProfile(\n        profile === "weak" || lowRamDevice,\n        deviceMemory?.logoMemoryBytes,\n      );\n'''
if old_init not in text:
    raise SystemExit('device memory init anchor missing')
text = text.replace(old_init, new_init, 1)

path.write_text(text)
