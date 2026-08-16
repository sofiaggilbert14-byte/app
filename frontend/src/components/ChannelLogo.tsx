import React from "react";
import { Platform, View, Text, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { colors, fonts, radius } from "@/src/theme";
import { useLocalLogo } from "@/src/core/localLogoFolder";

const MAX_URI_HISTORY = 192;
const LOAD_SLOT_TIMEOUT_MS = 10000;
const FAILURE_RETRY_MS = 15 * 60 * 1000;
let maxConcurrentImageLoads = 4;
let maxLoadQueue = 48;

type QueueEntry = {
  cancelled: boolean;
  grant: () => void;
};

let activeLoads = 0;
const loadQueue: QueueEntry[] = [];
const succeededUris = new Set<string>();
const failedUris = new Set<string>();
const successOrder: string[] = [];
const failureOrder: string[] = [];
const failedAt = new Map<string, number>();
const inFlightWaiters = new Map<string, Set<(success: boolean) => void>>();

function joinInFlight(uri: string, listener: (success: boolean) => void): (() => void) | null {
  const waiters = inFlightWaiters.get(uri);
  if (!waiters) return null;
  waiters.add(listener);
  return () => {
    waiters.delete(listener);
    if (!waiters.size && inFlightWaiters.get(uri) === waiters) inFlightWaiters.delete(uri);
  };
}

function beginInFlight(uri: string): void {
  if (!inFlightWaiters.has(uri)) inFlightWaiters.set(uri, new Set());
}

function finishInFlight(uri: string, success: boolean): void {
  const waiters = inFlightWaiters.get(uri);
  inFlightWaiters.delete(uri);
  waiters?.forEach((listener) => { try { listener(success); } catch {} });
}

/** Align logo decode/network pressure with the app's device profile. */
export function setChannelLogoMemoryProfile(lowMemory: boolean): void {
  maxConcurrentImageLoads = lowMemory ? 2 : 4;
  maxLoadQueue = lowMemory ? 24 : 48;
  while (loadQueue.length > maxLoadQueue) {
    const dropped = loadQueue.shift();
    if (dropped) dropped.cancelled = true;
  }
  drainQueue();
}

/** Drop only decoded/nonvisible logo memory; disk cache and active views survive. */
export function clearChannelLogoMemory(): void {
  for (const entry of loadQueue) entry.cancelled = true;
  loadQueue.splice(0, loadQueue.length);
  // Keep accounting for requests already handed to expo-image. Their load,
  // error, timeout, or unmount callbacks still release the held slots. Resetting
  // this counter here would let a second wave exceed the concurrency cap.
  succeededUris.clear();
  failedUris.clear();
  successOrder.splice(0, successOrder.length);
  failureOrder.splice(0, failureOrder.length);
  failedAt.clear();
  for (const uri of Array.from(inFlightWaiters.keys())) finishInFlight(uri, false);
  void (Image as any).clearMemoryCache?.().catch?.(() => undefined);
}

export async function clearChannelLogoCache(includeDisk = true): Promise<void> {
  clearChannelLogoMemory();
  if (includeDisk) await (Image as any).clearDiskCache?.().catch?.(() => undefined);
}

function remember(set: Set<string>, order: string[], uri: string): void {
  if (set.has(uri)) return;
  set.add(uri);
  order.push(uri);
  while (order.length > MAX_URI_HISTORY) {
    const oldest = order.shift();
    if (oldest) set.delete(oldest);
  }
}

function drainQueue(): void {
  while (activeLoads < maxConcurrentImageLoads && loadQueue.length) {
    const next = loadQueue.shift();
    if (!next || next.cancelled) continue;
    activeLoads += 1;
    next.grant();
  }
}

function requestLoadSlot(onGranted: () => void): () => void {
  const entry: QueueEntry = { cancelled: false, grant: onGranted };
  // Bound the waiter list — rapid surf used to enqueue unbounded work on weak sticks.
  while (loadQueue.length >= maxLoadQueue) {
    const dropped = loadQueue.shift();
    if (dropped) dropped.cancelled = true;
  }
  loadQueue.push(entry);
  drainQueue();
  return () => {
    entry.cancelled = true;
  };
}

function isRecentFailure(uri: string): boolean {
  if (!failedUris.has(uri)) return false;
  const timestamp = failedAt.get(uri) || 0;
  if (Date.now() - timestamp < FAILURE_RETRY_MS) return true;
  failedUris.delete(uri);
  failedAt.delete(uri);
  return false;
}

function releaseLoadSlot(): void {
  activeLoads = Math.max(0, activeLoads - 1);
  drainQueue();
}

function initials(name: string): string {
  const parts = name.replace(/[^a-zA-Z0-9 ]/g, "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function logoCandidates(uri?: string, localUri?: string): string[] {
  const value = (uri || "").trim();
  const local = (localUri || "").trim();
  if (!value) return local ? [local] : [];

  if (value.startsWith("//")) {
    return Platform.OS === "web"
      ? [local, `https:${value}`].filter(Boolean)
      : [local, `https:${value}`, `http:${value}`].filter(Boolean);
  }

  if (value.startsWith("http://")) {
    const secure = `https://${value.slice(7)}`;
    return (Platform.OS === "web" ? [local, secure, value] : [local, value, secure]).filter(Boolean);
  }

  if (value.startsWith("https://")) {
    if (Platform.OS === "web") return [local, value].filter(Boolean);
    return [local, value, `http://${value.slice(8)}`].filter(Boolean);
  }

  return local ? [local] : [];
}

function ChannelLogoComponent({
  name,
  logo,
  size = 48,
  disabled = false,
  visible = true,
}: {
  name: string;
  logo?: string;
  size?: number;
  disabled?: boolean;
  visible?: boolean;
}) {
  const localLogo = useLocalLogo(name);
  const candidates = React.useMemo(() => logoCandidates(logo, localLogo), [localLogo, logo]);
  const [attemptIndex, setAttemptIndex] = React.useState(0);
  const [allowedToLoad, setAllowedToLoad] = React.useState(false);
  const slotHeldRef = React.useRef(false);
  const leaderUriRef = React.useRef<string | null>(null);
  const slotTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentUri = candidates[attemptIndex];
  const hasCandidate = !disabled && visible && !!currentUri;

  const releaseIfHeld = React.useCallback(() => {
    if (slotTimerRef.current) {
      clearTimeout(slotTimerRef.current);
      slotTimerRef.current = null;
    }
    if (!slotHeldRef.current) return;
    slotHeldRef.current = false;
    releaseLoadSlot();
  }, []);

  React.useEffect(() => {
    setAttemptIndex(0);
    setAllowedToLoad(false);
    releaseIfHeld();
  }, [logo, disabled, visible, releaseIfHeld]);

  React.useEffect(() => {
    if (!hasCandidate || !currentUri) return;

    if (isRecentFailure(currentUri)) {
      if (attemptIndex + 1 < candidates.length) {
        setAttemptIndex((value) => value + 1);
      }
      return;
    }

    if (succeededUris.has(currentUri)) {
      setAllowedToLoad(true);
      return;
    }


    let mounted = true;
    const joined = joinInFlight(currentUri, (success) => {
      if (!mounted) return;
      if (success) setAllowedToLoad(true);
      else if (attemptIndex + 1 < candidates.length) setAttemptIndex((value) => value + 1);
    });
    if (joined) return joined;

    setAllowedToLoad(false);
    const cancelQueuedRequest = requestLoadSlot(() => {
      if (!mounted) {
        releaseLoadSlot();
        return;
      }
      slotHeldRef.current = true;
      leaderUriRef.current = currentUri;
      beginInFlight(currentUri);
      setAllowedToLoad(true);

      slotTimerRef.current = setTimeout(() => {
        if (!mounted) return;
        releaseIfHeld();
        finishInFlight(currentUri, false);
        leaderUriRef.current = null;
        setAllowedToLoad(false);
        if (attemptIndex + 1 < candidates.length) {
          setAttemptIndex((value) => value + 1);
        }
      }, LOAD_SLOT_TIMEOUT_MS);
    });

    return () => {
      mounted = false;
      cancelQueuedRequest();
      if (leaderUriRef.current === currentUri) {
        finishInFlight(currentUri, false);
        leaderUriRef.current = null;
      }
      releaseIfHeld();
    };
  }, [attemptIndex, candidates, currentUri, hasCandidate, releaseIfHeld]);

  if (hasCandidate && allowedToLoad && currentUri) {
    return (
      <Image
        source={{ uri: currentUri }}
        style={{ width: size, height: size, borderRadius: radius.sm }}
        contentFit="contain"
        cachePolicy="memory-disk"
        priority="low"
        allowDownscaling
        autoplay={false}
        recyclingKey={currentUri}
        transition={0}
        onLoad={() => {
          remember(succeededUris, successOrder, currentUri);
          finishInFlight(currentUri, true);
          leaderUriRef.current = null;
          releaseIfHeld();
        }}
        onLoadEnd={releaseIfHeld}
        onError={() => {
          remember(failedUris, failureOrder, currentUri);
          finishInFlight(currentUri, false);
          leaderUriRef.current = null;
          failedAt.set(currentUri, Date.now());
          if (failedAt.size > MAX_URI_HISTORY) {
            for (const uri of Array.from(failedAt.keys())) {
              if (!failedUris.has(uri)) failedAt.delete(uri);
            }
          }
          releaseIfHeld();
          setAllowedToLoad(false);
          if (attemptIndex + 1 < candidates.length) {
            setAttemptIndex((value) => value + 1);
          }
        }}
      />
    );
  }

  return (
    <View style={[styles.fallback, { width: size, height: size }]}>
      <Text style={[styles.initials, { fontSize: Math.max(10, Math.round(size * 0.34)) }]}>
        {initials(name)}
      </Text>
    </View>
  );
}

export const ChannelLogo = React.memo(ChannelLogoComponent);

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: colors.brandTertiary,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  initials: { color: colors.onBrandTertiary, fontFamily: fonts.bold },
});
