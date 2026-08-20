from pathlib import Path

p = Path('frontend/src/source.native.ts')
s = p.read_text(encoding='utf-8')
old = '''      // A native match-table write can race a cold app launch. Build a lookup
      // only for the missing subset instead of channels.map(...) across all 6k.
      if (missingAfterJoin.length) {
        const wanted = new Set(missingAfterJoin);
        const byId = new Map<string, Channel>();
        for (const channel of channels) {
          if (!wanted.has(channel.id)) continue;
          byId.set(channel.id, channel);
          if (byId.size >= wanted.size) break;
        }
        const xmltvIds: string[] = [];
        for (const id of missingAfterJoin) {
          const xmltvId = (byId.get(id)?.tvg_id || id).trim();
          if (xmltvId) xmltvIds.push(xmltvId);
        }
        if (xmltvIds.length) {
          const byXmltv = await loadNativeEpgWindow(xmltvIds, startMs, endMs);
          for (const playlistId of missingAfterJoin) {
            const xmltvId = (byId.get(playlistId)?.tvg_id || playlistId).trim();
            const list = byXmltv[xmltvId];
            if (list?.length) merged[playlistId] = list;
          }
        }
      }
'''
new = '''      // A native match-table write can race a cold app launch. The direct-primary
      // fallback is allowed only for channels still owned by the primary guide.
      // Never let stale built-in rows bleed into a user override or into primary-off
      // mode just because the ownership-aware join correctly returned no row.
      if (missingAfterJoin.length) {
        const ownership = await getEpgSourcePreferences();
        const userOwned = ownership.userEnabled
          ? ownership.userOverrides
          : {};
        const primaryFallbackIds = ownership.primaryEnabled
          ? missingAfterJoin.filter((id) => !Object.prototype.hasOwnProperty.call(userOwned, id))
          : [];

        if (primaryFallbackIds.length) {
          const wanted = new Set(primaryFallbackIds);
          const byId = new Map<string, Channel>();
          for (const channel of channels) {
            if (!wanted.has(channel.id)) continue;
            byId.set(channel.id, channel);
            if (byId.size >= wanted.size) break;
          }
          const xmltvIds: string[] = [];
          for (const id of primaryFallbackIds) {
            const xmltvId = (byId.get(id)?.tvg_id || id).trim();
            if (xmltvId) xmltvIds.push(xmltvId);
          }
          if (xmltvIds.length) {
            const byXmltv = await loadNativeEpgWindow(xmltvIds, startMs, endMs);
            for (const playlistId of primaryFallbackIds) {
              const xmltvId = (byId.get(playlistId)?.tvg_id || playlistId).trim();
              const list = byXmltv[xmltvId];
              if (list?.length) merged[playlistId] = list;
            }
          }
        }
      }
'''
if old not in s:
    raise SystemExit('guard failed: expected cache-miss fallback block not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
