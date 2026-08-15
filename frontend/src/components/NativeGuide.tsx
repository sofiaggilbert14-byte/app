import React, { useCallback, useMemo } from "react";
import { Platform, requireNativeComponent, StyleSheet, View } from "react-native";
import type { Channel, Program } from "@/src/api";

type Selection = { channelId: string; channelName: string; rowIndex: number; settled: boolean; title?: string; description?: string; category?: string; startMs?: number; stopMs?: number };
type Props = {
  channels: Channel[]; windowStart: string; windowEnd: string; active: boolean;
  channelNumberById?: Record<string, number>;
  onChannelPress(channel: Channel): void;
  onChannelFocus?(channel: Channel): void;
  onProgramFocus?(program: Program, channel: Channel): void;
  onProgramPress(program: Program, channel: Channel): void;
  onLeftBoundary?(): void; onBack?(): void;
  onViewportChannelIds?(ids: string[]): void;
};
const NativeSurface = Platform.OS === "android" ? requireNativeComponent<any>("CharmNativeGuide") : View;

export function NativeGuide({ channels, windowStart, windowEnd, active, channelNumberById, onChannelPress, onChannelFocus, onProgramFocus, onProgramPress, onLeftBoundary, onBack, onViewportChannelIds }: Props) {
  const rows = useMemo(() => channels.map((c, i) => ({ id: c.id, name: c.name, number: String(channelNumberById?.[c.id] ?? i + 1) })), [channels, channelNumberById]);
  const byId = useMemo(() => new Map(channels.map(c => [c.id, c])), [channels]);
  const decode = useCallback((event: any) => {
    const value: Selection = event.nativeEvent; const channel = byId.get(value.channelId); if (!channel) return null;
    const program: Program | undefined = value.title ? { title: value.title, desc: value.description || "", category: value.category || "", start: new Date(value.startMs || 0).toISOString(), stop: value.stopMs ? new Date(value.stopMs).toISOString() : null } : undefined;
    return { value, channel, program };
  }, [byId]);
  const onSelectionChange = useCallback((event: any) => { const item = decode(event); if (!item) return; const start = Math.max(0, item.value.rowIndex - 12); onViewportChannelIds?.(channels.slice(start, start + 25).map(c => c.id)); if (!item.value.settled) return; onChannelFocus?.(item.channel); if (item.program) onProgramFocus?.(item.program, item.channel); }, [channels, decode, onChannelFocus, onProgramFocus, onViewportChannelIds]);
  const onActivate = useCallback((event: any) => { const item = decode(event); if (!item) return; if (item.program) onProgramPress(item.program, item.channel); else onChannelPress(item.channel); }, [decode, onChannelPress, onProgramPress]);
  return <NativeSurface style={styles.surface} channels={rows} windowStartMs={Date.parse(windowStart)} windowEndMs={Date.parse(windowEnd)} active={active} onSelectionChange={onSelectionChange} onActivate={onActivate} onBoundary={(event: any) => event.nativeEvent.edge === "back" ? onBack?.() : onLeftBoundary?.()} />;
}
const styles = StyleSheet.create({ surface: { flex: 1, backgroundColor: "#080812" } });
