from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SHELL = ROOT / "frontend/src/components/PurpleTvShell.tsx"
SCAN = ROOT / "frontend/scripts/verify-overhaul-architecture.mjs"
TEST = ROOT / "frontend/tests/drawerNavigation.test.mjs"


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text()
    if old not in text:
        if new in text:
            print(f"{label}: already applied")
            return
        raise SystemExit(f"{label}: expected source block not found")
    path.write_text(text.replace(old, new, 1))
    print(f"{label}: applied")


replace_once(
    SHELL,
    '''const PRIMARY_NAV: NavItem[] = [
  { route: "/", label: "Live TV", icon: "tv-outline" },
  { route: "/guide", label: "TV Guide", icon: "calendar-outline" },
  { route: "/favorites", label: "Favorites", icon: "heart-outline" },
  { route: "/reminders", label: "My Reminders", icon: "notifications-outline" },
  { route: "/channels", label: "Channels", icon: "list-outline" },
  { route: "/movies", label: "Movies", icon: "film-outline" },
];

const SECONDARY_NAV: NavItem[] = [
  { route: "/series", label: "Series", icon: "albums-outline" },
  { route: "/catchup", label: "Catch Up", icon: "time-outline" },
  { route: "/search", label: "Search", icon: "search-outline" },
  { route: "/settings", label: "Settings", icon: "settings-outline" },
];

const NAV = [...PRIMARY_NAV, ...SECONDARY_NAV];''',
    '''const NAV: NavItem[] = [
  { route: "/", label: "Live TV", icon: "tv-outline" },
  { route: "/guide", label: "TV Guide", icon: "calendar-outline" },
  { route: "/favorites", label: "Favorites", icon: "heart-outline" },
  { route: "/reminders", label: "My Reminders", icon: "notifications-outline" },
  { route: "/channels", label: "Channels", icon: "list-outline" },
  { route: "/movies", label: "Movies", icon: "film-outline" },
  { route: "/series", label: "Series", icon: "albums-outline" },
  { route: "/catchup", label: "Catch Up", icon: "time-outline" },
  { route: "/search", label: "Search", icon: "search-outline" },
  { route: "/settings", label: "Settings", icon: "settings-outline" },
];''',
    "unify nav constants",
)

replace_once(
    SHELL,
    'focusDrawerTop ? PRIMARY_NAV[0].route : active',
    'focusDrawerTop ? NAV[0].route : active',
    "focus top route",
)

replace_once(
    SHELL,
    '''          <View style={styles.navSections} testID="purple-nav-bounded-sections">
            <View style={styles.primaryNavSection}>
              <ScrollView
                style={styles.primaryNavList}
                contentContainerStyle={styles.navListContent}
                showsVerticalScrollIndicator={false}
              >
                {PRIMARY_NAV.map(renderNavItem)}
              </ScrollView>
            </View>
            <View style={styles.secondaryNavSection}>
              <ScrollView
                style={styles.secondaryNavList}
                contentContainerStyle={styles.navListContent}
                showsVerticalScrollIndicator={false}
              >
                {SECONDARY_NAV.map(renderNavItem)}
              </ScrollView>
            </View>
          </View>''',
    '''          <View style={styles.navSections} testID="purple-nav-bounded-sections">
            <View style={styles.primaryNavSection}>
              <ScrollView
                style={styles.primaryNavList}
                contentContainerStyle={styles.navListContent}
                showsVerticalScrollIndicator={false}
              >
                {NAV.map(renderNavItem)}
              </ScrollView>
            </View>
          </View>''',
    "unify nav scroll box",
)

replace_once(
    SHELL,
    '''  navSections: { flex: 1, minHeight: 0, overflow: "hidden" },
  primaryNavSection: {
    flexShrink: 1,
    minHeight: 82,
    maxHeight: 212,
    overflow: "hidden",
    borderBottomWidth: 1,
    borderBottomColor: tvColors.line,
    paddingBottom: 5,
  },
  primaryNavList: { minHeight: 0 },
  secondaryNavSection: { flex: 1, minHeight: 58, overflow: "hidden", paddingTop: 5 },
  secondaryNavList: { flex: 1, minHeight: 0 },
  navListContent: { gap: 2, paddingBottom: 2 },''',
    '''  navSections: { flex: 1, minHeight: 0, overflow: "hidden" },
  primaryNavSection: { flex: 1, minHeight: 0, overflow: "hidden" },
  primaryNavList: { flex: 1, minHeight: 0 },
  navListContent: { gap: 2, paddingBottom: 2 },''',
    "make unified nav fill bounded box",
)

replace_once(
    SCAN,
    '''// Drawer must remain fully bounded with a pinned footer; overflowing routes scroll instead of covering Exit.
requireText("src/components/PurpleTvShell.tsx", "PRIMARY_NAV", "bounded primary drawer navigation is missing");
requireText("src/components/PurpleTvShell.tsx", "SECONDARY_NAV", "scrollable lower drawer navigation is missing");
requireText("src/components/PurpleTvShell.tsx", 'testID="purple-nav-bounded-sections"', "drawer navigation sections are not contained");
requireText("src/components/PurpleTvShell.tsx", 'testID="purple-nav-pinned-footer"', "Exit/footer is not pinned outside scrolling drawer content");''',
    '''// Drawer must remain two bounded surfaces on Guide: Groups + one unified route list, with Exit pinned below.
requireText("src/components/PurpleTvShell.tsx", "const NAV: NavItem[]", "unified drawer navigation list is missing");
forbidText("src/components/PurpleTvShell.tsx", "SECONDARY_NAV", "separate lower drawer navigation box returned");
requireText("src/components/PurpleTvShell.tsx", "{NAV.map(renderNavItem)}", "all drawer routes are not in the unified scrolling box");
requireText("src/components/PurpleTvShell.tsx", 'testID="purple-nav-bounded-sections"', "drawer navigation box is not contained");
requireText("src/components/PurpleTvShell.tsx", 'testID="purple-nav-pinned-footer"', "Exit/footer is not pinned outside scrolling drawer content");''',
    "update architecture drawer guard",
)

replace_once(
    TEST,
    '''  assert.doesNotMatch(shell, /NAV\\.slice\\(0,\\s*6\\)/);
  assert.doesNotMatch(shell, /useNativeDriver: false/);''',
    '''  assert.doesNotMatch(shell, /NAV\\.slice\\(0,\\s*6\\)/);
  assert.match(shell, /const NAV: NavItem\\[\\] = \\[/);
  assert.match(shell, /\\{NAV\\.map\\(renderNavItem\\)\\}/);
  assert.doesNotMatch(shell, /SECONDARY_NAV/);
  assert.match(shell, /testID="purple-nav-bounded-sections"/);
  assert.match(shell, /testID="purple-nav-pinned-footer"/);
  assert.doesNotMatch(shell, /useNativeDriver: false/);''',
    "add unified drawer regression assertions",
)

print("Unified drawer navigation patch complete.")
