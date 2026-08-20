from pathlib import Path

p = Path('frontend/src/utils/tvFocus.ts')
s = p.read_text(encoding='utf-8')
old = '''export function requestNativeFocusWithRetry(node: unknown, delaysMs = [0, 32, 96, 200]): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  delaysMs.forEach((delay) => {
    timers.push(
      setTimeout(() => {
        requestNativeFocus(node);
      }, delay),
    );
  });
  return () => timers.forEach(clearTimeout);
}
'''
new = '''export function requestNativeFocusWithRetry(node: unknown, delaysMs = [0, 32, 96, 200]): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  let completed = false;
  const cancel = () => {
    completed = true;
    for (const timer of timers) clearTimeout(timer);
  };
  delaysMs.forEach((delay) => {
    timers.push(
      setTimeout(() => {
        if (completed) return;
        // Once native focus succeeds, never fire a later retry under the user's
        // cursor. Late retries were a root cause of self-moving TV focus.
        if (requestNativeFocus(node)) cancel();
      }, delay),
    );
  });
  return cancel;
}
'''
if old not in s:
    raise SystemExit('guard failed: focus retry helper not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')

p = Path('frontend/src/components/PurpleTvShell.tsx')
s = p.read_text(encoding='utf-8')
old = '''    const clearPreferred = setTimeout(() => {
      setDrawerAutoFocus(false);
      setDrawerPreferredRoute(null);
    }, 700);'''
new = '''    const clearPreferred = setTimeout(() => {
      setDrawerAutoFocus(false);
      setDrawerPreferredRoute(null);
    }, 220);'''
if old not in s:
    raise SystemExit('guard failed: main drawer preferred-focus timeout not found')
s = s.replace(old, new, 1)
old = '''    const cancelFocus = requestNativeFocusWithRetry(preferredNode, [0, PURPLE_DRAWER_ANIMATION_MS, 280, 420, 650]);'''
new = '''    const cancelFocus = requestNativeFocusWithRetry(preferredNode, [0, PURPLE_DRAWER_ANIMATION_MS + 20]);'''
if old not in s:
    raise SystemExit('guard failed: main drawer focus retry sequence not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
