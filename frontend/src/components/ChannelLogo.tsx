import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { colors, fonts, radius } from "@/src/theme";

const MAX_CONCURRENT_IMAGE_LOADS = 4;
const MAX_URI_HISTORY = 1000;

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

function isRemoteLogo(uri?: string): uri is string {
  return !!uri && (uri.startsWith("https://") || uri.startsWith("http://"));
}

function ChannelLogoComponent({
  name,
  logo,
  size = 48,
  disabled = false,
}: {
  name: string;
  logo?: string;
  size?: number;
  disabled?: boolean;
}) {
  const [failed, setFailed] = React.useState(false);
  const [allowedToLoad, setAllowedToLoad] = React.useState(false);
  const slotHeldRef = React.useRef(false);

  React.useEffect(() => {
    setFailed(false);
    setAllowedToLoad(false);
    slotHeldRef.current = false;
  }, [logo]);

  const validLogo = !disabled && isRemoteLogo(logo) && !failed && !failedUris.has(logo);

  React.useEffect(() => {
    if (!validLogo || !logo) return;

    if (succeededUris.has(logo)) {
      setAllowedToLoad(true);
      return;
    }

    let mounted = true;
    const cancelQueuedRequest = requestLoadSlot(() => {
      if (!mounted) {
        releaseLoadSlot();
        return;
      }
      slotHeldRef.current = true;
      setAllowedToLoad(true);
    });

    return () => {
      mounted = false;
      cancelQueuedRequest();
      if (slotHeldRef.current) {
        slotHeldRef.current = false;
        releaseLoadSlot();
      }
    };
  }, [logo, validLogo]);

  const releaseIfHeld = React.useCallback(() => {
    if (!slotHeldRef.current) return;
    slotHeldRef.current = false;
    releaseLoadSlot();
  }, []);

  if (validLogo && allowedToLoad && logo) {
    return (
      <Image
        source={{ uri: logo }}
        style={{ width: size, height: size, borderRadius: radius.sm }}
        contentFit="contain"
        cachePolicy="disk"
        recyclingKey={logo}
        transition={0}
        onLoad={() => remember(succeededUris, successOrder, logo)}
        onLoadEnd={releaseIfHeld}
        onError={() => {
          remember(failedUris, failureOrder, logo);
          setFailed(true);
          releaseIfHeld();
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
