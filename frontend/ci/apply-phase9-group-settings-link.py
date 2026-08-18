from pathlib import Path

p = Path(__file__).resolve().parents[1] / "app/(tabs)/settings.tsx"
text = p.read_text(encoding="utf-8")
old = '''                <Action
                  label="Clear custom order"
                  icon="refresh-outline"
                  onPress={() => {
'''
new = '''                <Action
                  label="Manage groups & tabs"
                  icon="albums-outline"
                  onPress={() => router.push("/group-settings" as any)}
                />
                <Action
                  label="Clear custom order"
                  icon="refresh-outline"
                  onPress={() => {
'''
if text.count(old) != 1:
    raise SystemExit(f"settings group link anchor mismatch: {text.count(old)}")
p.write_text(text.replace(old, new, 1), encoding="utf-8")
print("Phase 9 group settings link added")
