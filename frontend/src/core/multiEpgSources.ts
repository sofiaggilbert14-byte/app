import { useCallback, useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";
import { replaceAdditionalEpgOwners } from "@/src/core/additionalEpgOwnership";

export type CustomEpgSourceRecord = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  refreshHours: 0 | 2 | 4 | 6 | 12 | 24;
  lastRefreshAt: number;
  lastStatus: string;
  overrides: Record<string, string>;
};

const KEY = "gs_custom_epg_sources_v2";
// Native supports eight user/custom sources total. The legacy `user` source
// occupies one slot, so the additional-source registry must stop at seven.
const MAX_SOURCES = 7;
let cached: CustomEpgSourceRecord[] = [];
let loaded = false;
let loading: Promise<CustomEpgSourceRecord[]> | null = null;
let mutationEpoch = 0;
let writeChain: Promise<void> = Promise.resolve();
const listeners = new Set<(value: CustomEpgSourceRecord[]) => void>();

function cleanId(raw: unknown): string {
  return String(raw || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 48);
}
function cleanUrl(raw: unknown): string {
  const value = String(raw || "").trim().slice(0, 2048);
  return /^https?:\/\//i.test(value) ? value : "";
}
function cleanOverrides(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const value: Record<string, string> = {};
  for (const [channelId, xmltvId] of Object.entries(raw as Record<string, unknown>).slice(0, 10_000)) {
    const channel = String(channelId || "").trim().slice(0, 180);
    const xmltv = String(xmltvId || "").trim().slice(0, 180);
    if (channel && xmltv && !channel.includes("://") && !xmltv.includes("://")) value[channel] = xmltv;
  }
  return value;
}
function normalizeRecord(raw: Partial<CustomEpgSourceRecord>): CustomEpgSourceRecord | null {
  const id = cleanId(raw.id);
  if (!id) return null;
  const refreshHours = raw.refreshHours === 0 || raw.refreshHours === 2 || raw.refreshHours === 4 || raw.refreshHours === 6 || raw.refreshHours === 24 ? raw.refreshHours : 12;
  return {
    id,
    name: String(raw.name || "Custom EPG").trim().replace(/\s+/g, " ").slice(0, 60) || "Custom EPG",
    url: cleanUrl(raw.url), enabled: raw.enabled === true,
    refreshHours, lastRefreshAt: Math.max(0, Number(raw.lastRefreshAt) || 0),
    lastStatus: String(raw.lastStatus || "Never updated").trim().slice(0, 180),
    overrides: cleanOverrides(raw.overrides),
  };
}
function normalize(raw: unknown): CustomEpgSourceRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomEpgSourceRecord[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const source = normalizeRecord(item || {});
    if (!source || seen.has(source.id)) continue;
    seen.add(source.id); out.push(source);
    if (out.length >= MAX_SOURCES) break;
  }
  return out;
}
function publishOwnership() {
  const ids = new Set<string>();
  for (const source of cached) {
    if (!source.enabled) continue;
    for (const channelId of Object.keys(source.overrides)) ids.add(channelId);
  }
  replaceAdditionalEpgOwners(ids);
}
function invalidateGuideOwnershipView() {
  // Dynamic import avoids a source -> preferences -> multi-source initialization cycle.
  void import("@/src/source")
    .then((module) => module.invalidateGuideOwnershipCaches())
    .catch(() => undefined);
}
async function load() {
  if (loaded) return cached;
  if (loading) return loading;
  const loadEpoch = mutationEpoch;
  loading = storage.getItem<CustomEpgSourceRecord[]>(KEY, []).then((raw) => {
    if (loaded || loadEpoch !== mutationEpoch) return cached;
    cached = normalize(raw);
    loaded = true;
    publishOwnership();
    invalidateGuideOwnershipView();
    return cached;
  });
  try { return await loading; } finally { loading = null; }
}
function commit(next: CustomEpgSourceRecord[]) {
  mutationEpoch += 1;
  cached = normalize(next); loaded = true;
  publishOwnership();
  listeners.forEach((listener) => { try { listener(cached); } catch {} });
  invalidateGuideOwnershipView();
  const snapshot = cached;
  writeChain = writeChain.then(async () => { await storage.setItem(KEY, snapshot); }).catch(() => {});
}
function afterHydration(action: () => void): void {
  if (loaded) { action(); return; }
  void load().then(action).catch(() => action());
}
export async function getMultiEpgSources(): Promise<CustomEpgSourceRecord[]> { return [...(await load())]; }
export function saveMultiEpgSource(source: CustomEpgSourceRecord) {
  const clean = normalizeRecord(source); if (!clean) return;
  afterHydration(() => {
    const index = cached.findIndex((item) => item.id === clean.id);
    commit(index >= 0 ? cached.map((item, at) => at === index ? clean : item) : [...cached, clean]);
  });
}
export function removeMultiEpgSource(id: string) {
  const clean = cleanId(id);
  afterHydration(() => commit(cached.filter((item) => item.id !== clean)));
}
export function clearMultiEpgChannelAssignments(channelId: string) {
  const channel = String(channelId || "").trim();
  if (!channel) return;
  afterHydration(() => {
  let changed = false;
  const next = cached.map((source) => {
    if (!Object.prototype.hasOwnProperty.call(source.overrides, channel)) return source;
    const overrides = { ...source.overrides };
    delete overrides[channel];
    changed = true;
    return { ...source, overrides };
  });
  if (changed) commit(next);
  });
}
export function assignMultiEpgChannel(sourceId: string, channelId: string, xmltvId: string) {
  const owner = cleanId(sourceId), channel = String(channelId || "").trim(), xmltv = String(xmltvId || "").trim();
  if (!owner || !channel || !xmltv) return;
  afterHydration(() => commit(cached.map((source) => ({ ...source, overrides: source.id === owner
    ? { ...source.overrides, [channel]: xmltv }
    : Object.fromEntries(Object.entries(source.overrides).filter(([id]) => id !== channel)) }))));
}
export function createCustomEpgSourceId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.slice(0, 24);
}
export function useMultiEpgSources() {
  const [sources, setSources] = useState(cached);
  useEffect(() => {
    let mounted = true; void load().then((next) => mounted && setSources(next));
    const listener = (next: CustomEpgSourceRecord[]) => mounted && setSources(next);
    listeners.add(listener); return () => { mounted = false; listeners.delete(listener); };
  }, []);
  const save = useCallback((source: CustomEpgSourceRecord) => {
    saveMultiEpgSource(source); setSources(cached);
  }, []);
  const remove = useCallback((id: string) => { removeMultiEpgSource(id); setSources(cached); }, []);
  return { sources, save, remove, canAdd: sources.length < MAX_SOURCES };
}
