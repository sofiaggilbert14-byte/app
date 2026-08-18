from pathlib import Path

p = Path('frontend/src/core/guideGroups.ts')
s = p.read_text(encoding='utf-8')
old = '''  if (opts.customOrder.length && group === "All") {
    const rank = new Map<string, number>();
    for (let index = 0; index < opts.customOrder.length; index++) rank.set(opts.customOrder[index], index);
    list.sort((a, b) => {
      const ar = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const br = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      if (ar !== br) return ar - br;
      return (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" });
    });
    return list;
  }

  if (group !== "All") {
    list.sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" }));
  }
'''
new = '''  if (opts.customOrder.length) {
    const rank = new Map<string, number>();
    for (let index = 0; index < opts.customOrder.length; index++) rank.set(opts.customOrder[index], index);
    list.sort((a, b) => {
      const ar = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const br = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      if (ar !== br) return ar - br;
      return (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" });
    });
    return list;
  }

  if (group !== "All") {
    list.sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" }));
  }
'''
if old not in s:
    raise SystemExit('guard failed: custom-order group sort block not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
