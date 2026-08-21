from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count == 1:
        return text.replace(old, new, 1)
    if count == 0 and new in text:
        return text
    raise SystemExit(f"{label}: expected one old match or already-patched text, found {count}")

native_path = Path("frontend/src/nativeEpg.ts")
native = native_path.read_text(encoding="utf-8")
old = 'export async function configureNativeUserGuideSources(primaryEnabled: boolean, sources: NativeUserGuideSource[]): Promise<void> { if (nativeModule?.configureUserGuideSources) await nativeModule.configureUserGuideSources(primaryEnabled, sources.slice(0, 8)); primaryGuideEnabled = primaryEnabled; ownershipRequiresSqlite = sources.some((source) => source.enabled && !!source.url); if (ramModule) await ramModule.clearMemory().catch(() => undefined); }'
new = 'export async function configureNativeUserGuideSources(primaryEnabled: boolean, sources: NativeUserGuideSource[], options?: { clearRam?: boolean }): Promise<void> { if (nativeModule?.configureUserGuideSources) await nativeModule.configureUserGuideSources(primaryEnabled, sources.slice(0, 8)); primaryGuideEnabled = primaryEnabled; ownershipRequiresSqlite = sources.some((source) => source.enabled && !!source.url); if (options?.clearRam !== false && ramModule) await ramModule.clearMemory().catch(() => undefined); }'
native = replace_once(native, old, new, "native EPG schedule/cache separation")
native_path.write_text(native, encoding="utf-8")

policy_path = Path("frontend/src/core/customEpgPolicy.ts")
policy = policy_path.read_text(encoding="utf-8")
policy = replace_once(
    policy,
    '''      ...extras.map((source) => ({\n        id: source.id,\n        url: source.url,\n        enabled: source.enabled,\n        refreshHours: source.refreshHours,\n      })),\n    ]);''',
    '''      ...extras.map((source) => ({\n        id: source.id,\n        url: source.url,\n        enabled: source.enabled,\n        refreshHours: source.refreshHours,\n      })),\n    ], { clearRam: false });''',
    "EPG schedule policy no-RAM-clear call",
)
policy_path.write_text(policy, encoding="utf-8")
print("EPG schedule policy isolated from native RAM invalidation")
