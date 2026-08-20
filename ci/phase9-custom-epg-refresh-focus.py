from pathlib import Path

p = Path('frontend/app/epg-custom.tsx')
s = p.read_text(encoding='utf-8')
old_focus = 'const timer = setTimeout(() => setPreferBackFocus(false), 550);'
new_focus = 'const timer = setTimeout(() => setPreferBackFocus(false), 180);'
if old_focus not in s:
    raise SystemExit('guard failed: custom EPG focus timer not found')
s = s.replace(old_focus, new_focus, 1)
old_refresh = '''      const result = await refreshNativeUserGuide(url);
      invalidateGuideOwnershipCaches();
      setXmltvPage(0);
      await reloadXmltvPage();
      setStatus(`Custom EPG indexed ${Math.max(0, Math.round(result.count || 0))} programmes.`);
'''
new_refresh = '''      const result = await refreshNativeUserGuide(url);
      invalidateGuideOwnershipCaches();
      setXmltvPage(0);
      // State updates are async; do not call reloadXmltvPage() here because it may
      // still capture the previous page. Read page 0 explicitly, then the normal
      // effect owns subsequent query/page changes.
      const firstPage = await listNativeUserGuideChannels(xmltvQuery, 0, XMLTV_PAGE_SIZE);
      setXmltvRows(firstPage.rows || []);
      setXmltvTotal(Math.max(0, Number(firstPage.total) || 0));
      setStatus(`Custom EPG indexed ${Math.max(0, Math.round(result.count || 0))} programmes.`);
'''
if old_refresh not in s:
    raise SystemExit('guard failed: custom EPG refresh block not found')
s = s.replace(old_refresh, new_refresh, 1)
p.write_text(s, encoding='utf-8')
