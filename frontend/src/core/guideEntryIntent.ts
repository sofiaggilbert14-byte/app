let openGroupsOnNextGuideEntry = false;

export function requestGuideGroupsOnEntry(): void {
  openGroupsOnNextGuideEntry = true;
}

export function consumeGuideGroupsOnEntry(): boolean {
  const requested = openGroupsOnNextGuideEntry;
  openGroupsOnNextGuideEntry = false;
  return requested;
}
