from pathlib import Path

p = Path('frontend/app/epg-custom.tsx')
s = p.read_text()
anchor = '  const xmltvPageCount = Math.max(1, Math.ceil(xmltvTotal / XMLTV_PAGE_SIZE));\n\n'
insert = '''  const xmltvPageCount = Math.max(1, Math.ceil(xmltvTotal / XMLTV_PAGE_SIZE));\n\n  useEffect(() => {\n    setChannelPage((current) => Math.max(0, Math.min(channelPageCount - 1, current)));\n  }, [channelPageCount]);\n\n'''
if anchor not in s:
    raise SystemExit('page-count anchor not found')
s = s.replace(anchor, insert, 1)
p.write_text(s)
