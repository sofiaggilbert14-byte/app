import dayjs from "dayjs";
import type { Program } from "@/src/api";

let use24h = false;

export function setTimeFormat24h(value: boolean): void {
  use24h = !!value;
}

export function getTimeFormat24h(): boolean {
  return use24h;
}

export function fmtTime(iso: string): string {
  return dayjs(iso).format(use24h ? "HH:mm" : "h:mm A");
}

export function fmtDayTime(iso: string): string {
  return dayjs(iso).format(use24h ? "ddd D MMM · HH:mm" : "ddd D MMM · h:mm A");
}

/** Compact relative age for Settings health rows ("3m ago", "2h ago"). */
export function formatRelativeAge(isoOrMs: string | number | null | undefined, nowMs = Date.now()): string {
  if (isoOrMs == null || isoOrMs === "") return "—";
  const ts = typeof isoOrMs === "number" ? isoOrMs : Date.parse(String(isoOrMs));
  if (!Number.isFinite(ts) || ts <= 0) return "—";
  const delta = Math.max(0, nowMs - ts);
  const minutes = Math.round(delta / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function nowNext(programs: Program[] | undefined, now: Date): { current?: Program; next?: Program } {
  if (!programs || programs.length === 0) return {};
  const t = now.getTime();
  let current: Program | undefined;
  let next: Program | undefined;
  for (let i = 0; i < programs.length; i++) {
    const p = programs[i];
    const s = new Date(p.start).getTime();
    const e = p.stop ? new Date(p.stop).getTime() : s + 30 * 60000;
    if (s <= t && t < e) {
      current = p;
      next = programs[i + 1];
      break;
    }
    if (s > t) {
      next = p;
      break;
    }
  }
  return { current, next };
}

export function progressPct(p: Program | undefined, now: Date): number {
  if (!p || !p.stop) return 0;
  const s = new Date(p.start).getTime();
  const e = new Date(p.stop).getTime();
  const t = now.getTime();
  if (t <= s) return 0;
  if (t >= e) return 100;
  return ((t - s) / (e - s)) * 100;
}

export function reminderKey(channelId: string, start: string): string {
  return `${channelId}|${start}`;
}
