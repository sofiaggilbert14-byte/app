import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { findNodeHandle, Platform, requireNativeComponent, type NativeSyntheticEvent, View } from "react-native";
import type { Channel, Program } from "@/src/api";

type SelectionEvent = { channelId: string; row: number; settled: boolean; pressed: boolean; program?: { title: string; desc: string; category: string; startMs: number; endMs: number } };
type RunwayEvent = { ids: string[]; priorityIds: string[]; pageSize: number; velocity: number; direction: number };
type Props = {
  channels: Channel[]; windowStart: string; windowEnd: string; active: boolean; restoreChannelId?: string | null; restoreTimeMs?: number | null; reloadGeneration?: number;
  channelNumberById: Record<string, number>;
  onChannelFocus: (channel: Channel, settled: boolean) => void;
  onProgramFocus: (program: Program, channel: Channel, settled: boolean) => void;
  onChannelPress: (channel: Channel) => void;
  onProgramPress: (program: Program, channel: Channel) => void;
  onViewportChannelIds: (ids: string[], priorityIds: string[], pageSize: number, velocity: number) => void;
  onNativeGuideTag?: (tag: number | null) => void;
  onLeftBoundary: () => void;
  onUpBoundary: () => void;
};
const Native = Platform.OS === "android" ? requireNativeComponent<any>("CharmNativeGuide") : null;

export const NativeGuideCanvas = memo(function NativeGuideCanvas({
  channels,
  windowStart,
  windowEnd,
  active,
  restoreChannelId,
  restoreTimeMs,
  reloadGeneration = 0,
  channelNumberById,
  onChannelFocus,
  onProgramFocus,
  onChannelPress,
  onProgramPress,
  onViewportChannelIds,
  onNativeGuideTag,
  onLeftBoundary,
  onUpBoundary,
}: Props) {
  // Build the lookup directly. `new Map(channels.map(...))` materialized a
  // second 6k-entry tuple array before Map construction on large playlists.
  const channelById = useMemo(() => {
    const map = new Map<string, Channel>();
    for (const channel of channels) map.set(channel.id, channel);
    return map;
  }, [channels]);

  // This is the one unavoidable full-list bridge payload. Keep it deliberately
  // lean: native Guide owns only id/name/number, never stream URLs/logos/programs.
  const nativeChannels = useMemo(() => {
    const rows = new Array<{ id: string; name: string; number: string }>(channels.length);
    for (let index = 0; index < channels.length; index++) {
      const channel = channels[index];
      rows[index] = {
        id: channel.id,
        name: channel.name,
        number: String(channelNumberById[channel.id] || ""),
      };
    }
    return rows;
  }, [channelNumberById, channels]);

  const windowStartMs = Date.parse(windowStart);
  const windowEndMs = Date.parse(windowEnd);
  const validRestoreChannelId = useMemo(() => {
    const requested = String(restoreChannelId || "").trim();
    if (requested && channelById.has(requested)) return requested;
    return channels[0]?.id || "";
  }, [channelById, channels, restoreChannelId]);
  const validRestoreTimeMs = useMemo(() => {
    const requested = Number(restoreTimeMs || 0);
    if (!Number.isFinite(requested) || requested <= 0) return 0;
    if (!Number.isFinite(windowStartMs) || !Number.isFinite(windowEndMs) || windowEndMs <= windowStartMs) return 0;
    return Math.max(windowStartMs, Math.min(windowEndMs - 1, requested));
  }, [restoreTimeMs, windowEndMs, windowStartMs]);
  const [deferredRestoreChannelId, setDeferredRestoreChannelId] = useState("");
  const [deferredRestoreTimeMs, setDeferredRestoreTimeMs] = useState(0);

  // Apply restore props one render after the native channel/window props. This
  // avoids Android prop-order races where restoreChannel is evaluated while the
  // view still has its previous (or empty) row list and silently falls to row 1.
  useEffect(() => {
    setDeferredRestoreChannelId(validRestoreChannelId);
    setDeferredRestoreTimeMs(validRestoreTimeMs);
  }, [validRestoreChannelId, validRestoreTimeMs]);

  const handleSelectionChange = useCallback((event: NativeSyntheticEvent<SelectionEvent>) => {
    const value = event.nativeEvent;
    const channel = channelById.get(value.channelId);
    if (!channel) return;
    const program = value.program
      ? {
          title: value.program.title,
          desc: value.program.desc,
          category: value.program.category,
          start: new Date(value.program.startMs).toISOString(),
          stop: new Date(value.program.endMs).toISOString(),
        }
      : null;
    if (program) onProgramFocus(program, channel, value.settled);
    else onChannelFocus(channel, value.settled);
    if (value.pressed) {
      if (program) onProgramPress(program, channel);
      else onChannelPress(channel);
    }
  }, [channelById, onChannelFocus, onChannelPress, onProgramFocus, onProgramPress]);

  const handleRunwayChange = useCallback((event: NativeSyntheticEvent<RunwayEvent>) => {
    const value = event.nativeEvent;
    onViewportChannelIds(value.ids || [], value.priorityIds || [], value.pageSize || 8, Math.max(0, value.velocity || 0));
  }, [onViewportChannelIds]);

  const bindNativeGuideRef = useCallback((node: unknown) => {
    const tag = node ? findNodeHandle(node as any) : null;
    onNativeGuideTag?.(typeof tag === "number" ? tag : null);
  }, [onNativeGuideTag]);

  if (!Native) return <View style={{ flex: 1 }} />;
  return (
    <Native
      ref={bindNativeGuideRef}
      style={{ flex: 1 }}
      channels={nativeChannels}
      windowStartMs={windowStartMs}
      windowEndMs={windowEndMs}
      active={active}
      restoreChannelId={deferredRestoreChannelId}
      restoreTimeMs={deferredRestoreTimeMs}
      reloadGeneration={reloadGeneration}
      onSelectionChange={handleSelectionChange}
      onRunwayChange={handleRunwayChange}
      onLeftBoundary={onLeftBoundary}
      onUpBoundary={onUpBoundary}
    />
  );
});
