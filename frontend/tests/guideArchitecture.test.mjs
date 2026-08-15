import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFile(join(root, path), "utf8");

test("ProgramModal owns reminder toggling and Guide preview opens My Reminders", async () => {
  const [store, guide, modal, preview] = await Promise.all([
    source("src/store.tsx"),
    source("app/(tabs)/guide.tsx"),
    source("src/components/ProgramModal.tsx"),
    source("src/components/GuidePreviewRail.tsx"),
  ]);
  assert.match(store, /toggleReminder: \(program: Program, channel: Channel\)/);
  assert.match(store, /reminderDesiredStateRef/);
  assert.match(store, /reminderMutationRef/);
  assert.match(guide, /onOpenReminders/);
  assert.match(guide, /router\.replace\("\/reminders"/);
  assert.match(modal, /const \{ activeProgram, closeProgram, toggleReminder, reminders \} = useStore\(\)/);
  assert.doesNotMatch(modal, /addReminder|removeReminder/);
  assert.match(preview, /onPress=\{onOpenReminders\}/);
  assert.match(preview, />Reminders</);
  assert.doesNotMatch(preview, /clock24h|onInfo|onRemind/);
});

test("guide uses a top preview/actions/details strip above the full-width grid", async () => {
  const [guide, shell, preview] = await Promise.all([
    source("app/(tabs)/guide.tsx"),
    source("src/components/PurpleTvShell.tsx"),
    source("src/components/GuidePreviewRail.tsx"),
  ]);
  const railPosition = guide.indexOf("<GuidePreviewRail");
  const gridPosition = guide.indexOf("<TimelineGrid");
  assert.ok(railPosition >= 0 && gridPosition > railPosition);
  assert.match(guide, /const guideTopPanelWidth = useMemo/);
  assert.match(preview, /styles\.previewColumn/);
  assert.match(preview, /styles\.actionGrid/);
  assert.match(preview, /styles\.copy/);
  assert.match(preview, /styles\.actionColumn/);
  assert.doesNotMatch(guide, /const detailsRailWidth = useMemo/);
  assert.doesNotMatch(guide, /NowPlayingBar|guide-now-playing/);
  assert.doesNotMatch(guide, /footerAction|purple-guide-reset/);
  assert.match(shell, /const NAV: NavItem\[\] = \[/);
  assert.match(shell, /\{NAV\.map\(renderNavItem\)\}/);
  assert.doesNotMatch(shell, /SECONDARY_NAV/);
  assert.match(shell, /purple-nav-bounded-sections/);
  assert.match(shell, /purple-nav-pinned-footer/);
});

test("focus metadata is immediate while decoder tune stays delayed and restores by channel id", async () => {
  const [guide, timeline, box, focusLock] = await Promise.all([
    source("app/(tabs)/guide.tsx"),
    source("src/components/TimelineGrid.tsx"),
    source("src/components/BoxGrid.tsx"),
    source("src/utils/tvGuideFocusLock.ts"),
  ]);
  assert.match(guide, /setGuideFocusedProgram\(channel\.id, program\)/);
  assert.match(guide, /useGuideSelection\(\)/);
  assert.match(guide, /schedulePreview\(/);
  assert.match(guide, /previewId === requestedId && previewStatus !== "error"/);
  assert.match(guide, /focusGuideProgramCell\(origin\.channelId, origin\.programStart\)/);
  assert.match(timeline, /noteGuideChannelFocus\(item\.id/);
  assert.match(box, /noteGuideChannelFocus\(item\.id/);
  assert.match(focusLock, /registerGuideChannelNode/);
  assert.match(focusLock, /focusedGuideChannelId/);
  assert.match(focusLock, /cancelGuideFocusRestore/);
  assert.match(focusLock, /cancelGuideRestoreTimers/);
  assert.match(focusLock, /guideChannelNodes\.delete\(channelId\)/);
  assert.doesNotMatch(focusLock, /\|\|\s*guideEntryNode/);
  assert.match(timeline, /preservePendingFocus/);
  assert.match(timeline, /pendingProgramCellHidden/);
  assert.match(timeline, /lastViewportBucketRef/);
  assert.match(timeline, /viewport \* 0\.3/);
  assert.match(box, /lastViewportBucketRef/);
  assert.doesNotMatch(timeline, /reclaimToken|mountedBandRef|disableProgramCull/);
  assert.doesNotMatch(box, /mountedRowBandRef/);
  assert.match(timeline, /key: `\$\{item\.id\}:slot:\$\{logicalSlot\}`/);
  assert.doesNotMatch(timeline, /key: `\$\{item\.id\}:\$\{program\.start\}/);
});
