import { useCallback, useEffect, useMemo, useState } from "react";
import { storage } from "@/src/utils/storage";

export type UserEpgAssignments = Record<string, string>;

export type EpgSourceOwnership = {
  builtInEnabled: boolean;
  userEnabled: boolean;
  userUrl: string;
  userAssignments: UserEpgAssignments;
};

const KEY = "phase9_epg_source_ownership_v1";
const MAX_ASSIGNMENTS = 25_000;
const MAX_URL_LENGTH = 2048;

const DEFAULTS: EpgSourceOwnership = {
  builtInEnabled: true,
  userEnabled: false,
  userUrl: "",
  userAssignments: {},
};

let snapshot: EpgSourceOwnership = DEFAULTS;
let loaded = false;
let loadPromise: Promise<EpgSourceOwnership> | null = null;
let writeActive = false;
let pendingWrite: EpgSourceOwnership | null = null;
const listeners = new Set<(value: EpgSourceOwnership) => void>();

function cleanUrl(value: unknown): string {
  const url = String(value || "").trim().slice(0, MAX_URL_LENGTH);
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return url;
  } catch {
    return "";
  }
}

function cleanAssignments(value: unknown): UserEpgAssignments {
  if (!value || typeof value !== "object") return {};
  const out: UserEpgAssignments = {};
  let count = 0;
  for (const [rawChannelId, rawXmltvId] of Object.entries(value as Record<string, unknown>)) {
    const channelId = String(rawChannelId || "").trim().slice(0, 180);
    const xmltvId = String(rawXmltvId || "").trim().slice(0, 240);
    if (!channelId || !xmltvId) continue;
    out[channelId] = xmltvId;
    count += 1;
    if (count >= MAX_ASSIGNMENTS) break;
  }
  return out;
}

function normalize(value: unknown): EpgSourceOwnership {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<EpgSourceOwnership>;
  const userUrl = cleanUrl(raw.userUrl);
  return {
    builtInEnabled: raw.builtInEnabled !== false,
    userEnabled: !!raw.userEnabled && !!userUrl,
    userUrl,
    userAssignments: cleanAssignments(raw.userAssignments),
  };
}

async function load(): Promise<EpgSourceOwnership> {
  if (loaded) return snapshot;
  if (loadPromise) return loadPromise;
  loadPromise = storage.getItem<EpgSourceOwnership>(KEY, DEFAULTS).then((value) => {
    snapshot = normalize(value);
    loaded = true;
    return snapshot;
  });
  try {
    return await loadPromise;
  } finally {
    loadPromise = null;
  }
}

async function flush(): Promise<void> {
  if (writeActive) return;
  writeActive = true;
  try {
    while (pendingWrite) {
      const next = pendingWrite;
      pendingWrite = null;
      await storage.setItem(KEY, next);
    }
  } finally {
    writeActive = false;
    if (pendingWrite) void flush();
  }
}

function publish(next: EpgSourceOwnership): void {
  if (next === snapshot) return;
  snapshot = next;
  loaded = true;
  pendingWrite = next;
  void flush();
  for (const listener of Array.from(listeners)) {
    if (!listeners.has(listener)) continue;
    try { listener(next); } catch {}
  }
}

export async function getEpgSourceOwnership(): Promise<EpgSourceOwnership> {
  return load();
}

export function getEpgSourceOwnershipSnapshot(): EpgSourceOwnership {
  return snapshot;
}

export function userXmltvStorageId(xmltvId: string): string {
  return `user:${String(xmltvId || "").trim()}`;
}

export function resolveOwnedXmltvId(
  playlistChannelId: string,
  builtInXmltvId: string,
  ownership: EpgSourceOwnership,
): { xmltvId: string; owner: "user" | "builtin" | "none" } {
  const userId = ownership.userEnabled ? ownership.userAssignments[playlistChannelId] : "";
  if (userId) return { xmltvId: userXmltvStorageId(userId), owner: "user" };
  if (ownership.builtInEnabled && builtInXmltvId) return { xmltvId: builtInXmltvId, owner: "builtin" };
  return { xmltvId: "", owner: "none" };
}

export function useEpgSourceOwnership() {
  const [value, setValue] = useState(snapshot);
  useEffect(() => {
    let mounted = true;
    void load().then((next) => mounted && setValue(next));
    const listener = (next: EpgSourceOwnership) => mounted && setValue(next);
    listeners.add(listener);
    return () => {
      mounted = false;
      listeners.delete(listener);
    };
  }, []);

  const setBuiltInEnabled = useCallback((builtInEnabled: boolean) => {
    if (snapshot.builtInEnabled === builtInEnabled) return;
    publish({ ...snapshot, builtInEnabled });
  }, []);

  const setUserUrl = useCallback((raw: string) => {
    const userUrl = cleanUrl(raw);
    if (snapshot.userUrl === userUrl) return;
    publish({ ...snapshot, userUrl, userEnabled: snapshot.userEnabled && !!userUrl });
  }, []);

  const setUserEnabled = useCallback((userEnabled: boolean) => {
    const next = !!userEnabled && !!snapshot.userUrl;
    if (snapshot.userEnabled === next) return;
    publish({ ...snapshot, userEnabled: next });
  }, []);

  const assignUserXmltv = useCallback((playlistChannelId: string, xmltvId: string | null) => {
    const channelId = String(playlistChannelId || "").trim().slice(0, 180);
    const sourceId = String(xmltvId || "").trim().slice(0, 240);
    if (!channelId) return;
    const existing = snapshot.userAssignments[channelId];
    if ((!sourceId && !existing) || sourceId === existing) return;
    const userAssignments = { ...snapshot.userAssignments };
    if (!sourceId) delete userAssignments[channelId];
    else {
      if (!existing && Object.keys(userAssignments).length >= MAX_ASSIGNMENTS) return;
      userAssignments[channelId] = sourceId;
    }
    publish({ ...snapshot, userAssignments });
  }, []);

  const clearUserAssignments = useCallback(() => {
    if (!Object.keys(snapshot.userAssignments).length) return;
    publish({ ...snapshot, userAssignments: {} });
  }, []);

  return useMemo(() => ({
    ...value,
    setBuiltInEnabled,
    setUserUrl,
    setUserEnabled,
    assignUserXmltv,
    clearUserAssignments,
  }), [assignUserXmltv, clearUserAssignments, setBuiltInEnabled, setUserEnabled, setUserUrl, value]);
}
