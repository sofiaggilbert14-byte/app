import React from "react";
import { Platform, View, Text, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { colors, fonts, radius } from "@/src/theme";

const MAX_CONCURRENT_IMAGE_LOADS = 3;
const MAX_URI_HISTORY = 256;
const LOAD_SLOT_TIMEOUT_MS = 10000;

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
  while (activeLoads < MAX_CONCURRENT_IMAGE_LOADS && loadQueue.length) {
    const next = loadQueue.shift();
    if (!next || next.cancelled) continue;
    activeLoads += 1;
    next.grant();
  }
}

function requestLoadSlot(onGranted: () => void): () => void {
  const entry: QueueEntry = { cancelled: false, grant: onGranted };
  loadQueue.push(entry);
  drainQueue();
  return () => {
    entry.cancelled = true;
  };
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

function logoCandidates(uri?: string): string[] {
  const value = (uri || "").trim();
  if (!value) return [];

  if (value.startsWith("//")) {
    return Platform.OS === "web"
      ? [`https:${value}`]
      : [`https:${value}`, `http:${value}`];
  }

  if (value.startsWith("http://")) {
    const secure = `https://${value.slice(7)}`;
    return Platform.OS === "web" ? [secure, value] : [value, secure];
  }

  if (value.startsWith("https://")) {
    if (Platform.OS === "web") return [value];
    return [value, `http://${value.slice(8)}`];
  }

  return [];
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
  const candidates = React.useMemo(() => logoCandidates(logo), [logo]);
  const [attemptIndex, setAttemptIndex] = React.useState(0);
  const [allowedToLoad, setAllowedToLoad] = React.useState(false);
  const slotHeldRef = React.useRef(false);
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

    if (failedUris.has(currentUri)) {
      if (attemptIndex + 1 < candidates.length) {
        setAttemptIndex((value) => value + 1);
      }
      return;
    }

    if (succeededUris.has(currentUri)) {
      setAllowedToLoad(true);
      return;
    }

    setAllowedToLoad(false);
    let mounted = true;
    const cancelQueuedRequest = requestLoadSlot(() => {
      if (!mounted) {
        releaseLoadSlot();
        return;
      }
      slotHeldRef.current = true;
      setAllowedToLoad(true);

      slotTimerRef.current = setTimeout(() => {
        if (!mounted) return;
        releaseIfHeld();
        setAllowedToLoad(false);
        if (attemptIndex + 1 < candidates.length) {
          setAttemptIndex((value) => value + 1);
        }
      }, LOAD_SLOT_TIMEOUT_MS);
    });

    return () => {
      mounted = false;
      cancelQueuedRequest();
      releaseIfHeld();
    };
  }, [attemptIndex, candidates, currentUri, hasCandidate, releaseIfHeld]);

  if (hasCandidate && allowedToLoad && currentUri) {
    return (
      <Image
        source={{ uri: currentUri }}
        style={{ width: size, height: size, borderRadius: radius.sm }}
        contentFit="contain"
        cachePolicy="disk"
        priority="low"
        allowDownscaling
        autoplay={false}
        recyclingKey={currentUri}
        transition={0}
        onLoad={() => {
          remember(succeededUris, successOrder, currentUri);
          releaseIfHeld();
        }}
        onLoadEnd={releaseIfHeld}
        onError={() => {
          remember(failedUris, failureOrder, currentUri);
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
