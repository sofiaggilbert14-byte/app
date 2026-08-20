from pathlib import Path

path = Path("frontend/src/source.native.ts")
text = path.read_text(encoding="utf-8")
old = '''    const oldById = new Map((cached?.channels || []).map((channel) => [channel.id, channel]));
    const channels = fresh.map((channel) => {
      const previous = oldById.get(channel.id);
      if (!previous) return channel;
      return {
        ...channel,
        tvg_id: previous.tvg_id || channel.tvg_id,
        logo: channel.logo || previous.logo,
      };
    });'''
new = '''    // The native parser already returned a fresh channel array. Reuse those
    // objects while carrying forward logical EPG/logo identity; cloning all
    // 6k+ rows here doubles the transient heap during token-only refreshes.
    const oldById = new Map<string, Channel>();
    for (const channel of cached?.channels || []) oldById.set(channel.id, channel);
    for (const channel of fresh) {
      const previous = oldById.get(channel.id);
      if (!previous) continue;
      channel.tvg_id = previous.tvg_id || channel.tvg_id;
      channel.logo = channel.logo || previous.logo;
    }
    const channels = fresh;'''
if old not in text:
    raise SystemExit("refreshPlaylistOnly block not found; refusing fuzzy patch")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
