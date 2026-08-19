from pathlib import Path

path = Path('frontend/src/source.native.ts')
text = path.read_text(encoding='utf-8')
old = 'matchChannelsWithPhases(cached.channels, indexes, epgLogos, getLogoPriority(), async (partial, partialQuality) => {'
new = 'matchChannelsWithPhases(cached.channels, indexes, epgLogos, await getLogoPriority(), async (partial, partialQuality) => {'
if old not in text:
    raise SystemExit('expected logo priority call not found')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
