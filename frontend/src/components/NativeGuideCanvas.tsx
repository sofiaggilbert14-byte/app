import React, { memo, useCallback, useMemo } from "react";
import { Platform, requireNativeComponent, type NativeSyntheticEvent, View } from "react-native";
import type { Channel, Program } from "@/src/api";

type SelectionEvent = { channelId: string; row: number; settled: boolean; pressed: boolean; program?: { title: string; desc: string; category: string; startMs: number; endMs: number } };
type RunwayEvent = { ids: string[]; priorityIds: string[]; pageSize: number; velocity: number; direction: number };
type Props = {
  channels: Channel[]; windowStart: string; windowEnd: string; active: boolean; restoreChannelId?: string | null; restoreTimeMs?: number | null;
  channelNumberById: Record<string, number>;
  onChannelFocus: (channel: Channel, settled: boolean) => void;
  onProgramFocus: (program: Program, channel: Channel, settled: boolean) => void;
  onChannelPress: (channel: Channel) => void;
  onProgramPress: (program: Program, channel: Channel) => void;
  onViewportChannelIds: (ids: string[], priorityIds: string[], pageSize: number) => void;
  onLeftBoundary: () => void;
  onUpBoundary: () => void;
};
const Native = Platform.OS === "android" ? requireNativeComponent<any>("CharmNativeGuide") : null;

export const NativeGuideCanvas = memo(function NativeGuideCanvas(props: Props) {
  const channelById = useMemo(() => new Map(props.channels.map((channel) => [channel.id, channel])), [props.channels]);
  const nativeChannels = useMemo(() => props.channels.map((channel) => ({ id: channel.id, name: channel.name, number: String(props.channelNumberById[channel.id] || "") })), [props.channelNumberById, props.channels]);
  const windowStartMs = Date.parse(props.windowStart);
  const windowEndMs = Date.parse(props.windowEnd);
  const restoreChannelId = useMemo(() => {
    const requested = String(props.restoreChannelId || "").trim();
    if (requested && channelById.has(requested)) return requested;
    return props.channels[0]?.id || "";
  }, [channelById, props.channels, props.restoreChannelId]);
  const restoreTimeMs = useMemo(() => {
    const requested = Number(props.restoreTimeMs || 0);
    if (!Number.isFinite(requested) || requested <= 0) return 0;
    if (!Number.isFinite(windowStartMs) || !Number.isFinite(windowEndMs) || windowEndMs <= windowStartMs) return 0;
    return Math.max(windowStartMs, Math.min(windowEndMs - 1, requested));
  }, [props.restoreTimeMs, windowEndMs, windowStartMs]);
  const onSelectionChange = useCallback((event: NativeSyntheticEvent<SelectionEvent>) => {
    const value = event.nativeEvent; const channel = channelById.get(value.channelId); if (!channel) return;
    const program = value.program ? { title: value.program.title, desc: value.program.desc, category: value.program.category, start: new Date(value.program.startMs).toISOString(), stop: new Date(value.program.endMs).toISOString() } : null;
    if (program) props.onProgramFocus(program, channel, value.settled); else props.onChannelFocus(channel, value.settled);
    if (value.pressed) { if (program) props.onProgramPress(program, channel); else props.onChannelPress(channel); }
  }, [channelById, props]);
  const onRunwayChange = useCallback((event: NativeSyntheticEvent<RunwayEvent>) => {
    const value = event.nativeEvent; props.onViewportChannelIds(value.ids || [], value.priorityIds || [], value.pageSize || 8);
  }, [props]);
  if (!Native) return <View style={{ flex: 1 }} />;
  return <Native style={{ flex: 1 }} channels={nativeChannels} windowStartMs={windowStartMs} windowEndMs={windowEndMs} active={props.active} restoreChannelId={restoreChannelId} restoreTimeMs={restoreTimeMs} onSelectionChange={onSelectionChange} onRunwayChange={onRunwayChange} onLeftBoundary={props.onLeftBoundary} onUpBoundary={props.onUpBoundary} />;
});
