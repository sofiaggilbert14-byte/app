from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
p = ROOT / 'frontend/app/player.tsx'
s = p.read_text(encoding='utf-8')
old = '''      requestGuideJump({\n        channelId: currentChannelId,\n        group: currentChannel?.group || "All",\n      });'''
new = '''      requestGuideJump({\n        channelId: currentChannelId,\n        // Raw provider groups can be hidden in Phase 9. Restore the exact\n        // channel through All so fullscreen -> Guide never depends on an\n        // invisible M3U category.\n        group: "All",\n      });'''
if old not in s:
    raise SystemExit('player Guide jump anchor missing')
s = s.replace(old, new, 1)
# currentChannel is no longer needed just for provider group routing.
s = s.replace('    const currentChannel = channelById(currentChannelId);\n', '', 1)
s = s.replace('  }, [channelById, router]);', '  }, [router]);', 1)
p.write_text(s, encoding='utf-8')
print('phase9 fullscreen Guide anchor repaired')
