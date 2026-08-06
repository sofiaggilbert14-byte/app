import { Platform } from "react-native";
import { Program } from "@/src/api";

type Database = {
  execAsync: (sql: string) => Promise<void>;
  runAsync: (sql: string, params?: unknown[]) => Promise<unknown>;
  getAllAsync: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
  getFirstAsync: <T>(sql: string, params?: unknown[]) => Promise<T | null>;
  withExclusiveTransactionAsync: (task: (txn: Database) => Promise<void>) => Promise<void>;
};

type ProgramRow = {
  channel_id: string;
  start_ms: number;
  stop_ms: number;
  title: string;
  description: string | null;
  category: string | null;
};

export type EpgDbStats = {
  programCount: number;
  channelCount: number;
};

let databasePromise: Promise<Database | null> | null = null;

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function openDatabase(): Promise<Database | null> {
  if (Platform.OS === "web") return null;
  if (!databasePromise) {
    databasePromise = (async () => {
      // The dependency is installed only in the native Experimental build.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const SQLite = require("expo-sqlite") as {
        openDatabaseAsync: (name: string, options?: Record<string, unknown>) => Promise<Database>;
      };
      const db = await SQLite.openDatabaseAsync("charm_epg_v1.db", {
        finalizeUnusedStatementsBeforeClosing: false,
      });
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA temp_store = MEMORY;
        PRAGMA cache_size = -16384;
        PRAGMA mmap_size = 67108864;
        PRAGMA busy_timeout = 5000;
        PRAGMA wal_autocheckpoint = 1000;
        CREATE TABLE IF NOT EXISTS programs (
          channel_id TEXT NOT NULL,
          start_ms INTEGER NOT NULL,
          stop_ms INTEGER NOT NULL,
          title TEXT NOT NULL,
          description TEXT,
          category TEXT,
          PRIMARY KEY (channel_id, start_ms, title)
        ) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS programs_channel_time
          ON programs(channel_id, start_ms, stop_ms);
        CREATE TABLE IF NOT EXISTS programs_staging (
          channel_id TEXT NOT NULL,
          start_ms INTEGER NOT NULL,
          stop_ms INTEGER NOT NULL,
          title TEXT NOT NULL,
          description TEXT,
          category TEXT,
          PRIMARY KEY (channel_id, start_ms, title)
        ) WITHOUT ROWID;
      `);
      return db;
    })().catch(() => null);
  }
  return databasePromise;
}

export async function replaceIndexedPrograms(
  programs: Record<string, Program[]>,
  onProgress?: (ratio: number) => void,
): Promise<EpgDbStats> {
  const db = await openDatabase();
  const entries = Object.entries(programs);
  if (!db) {
    return {
      programCount: entries.reduce((total, [, list]) => total + list.length, 0),
      channelCount: entries.filter(([, list]) => list.length > 0).length,
    };
  }

  const total = Math.max(1, entries.reduce((sum, [, list]) => sum + list.length, 0));
  let written = 0;
  const batch: unknown[] = [];
  const valueSql: string[] = [];
  
  // Increased batch size from 80 to 160 for faster inserts
  // SQLite supports up to 999 parameters safely; 160 rows × 6 cols = 960 params
  const MAX_BATCH_SIZE = 160;

  const flush = async () => {
    if (!valueSql.length) return;
    await db.runAsync(
      `INSERT OR REPLACE INTO programs_staging
       (channel_id, start_ms, stop_ms, title, description, category)
       VALUES ${valueSql.join(",")}`,
      batch,
    );
    batch.length = 0;
    valueSql.length = 0;
    onProgress?.(Math.min(1, written / total));
    await nextTick();
  };

  await db.execAsync("DELETE FROM programs_staging;");
  for (const [channelId, list] of entries) {
    for (const program of list) {
      const startMs = Date.parse(program.start);
      const stopMs = program.stop ? Date.parse(program.stop) : startMs + 30 * 60 * 1000;
      if (!Number.isFinite(startMs) || !Number.isFinite(stopMs) || stopMs <= startMs) continue;
      valueSql.push("(?, ?, ?, ?, ?, ?)");
      batch.push(
        channelId,
        startMs,
        stopMs,
        program.title || "No Title",
        program.desc || null,
        program.category || null,
      );
      written++;
      if (valueSql.length >= MAX_BATCH_SIZE) await flush();
    }
  }
  await flush();

  // Only the final swap blocks readers, and it is a short local copy inside one
  // transaction. A failed refresh therefore never destroys the last good EPG.
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.execAsync(`
      DELETE FROM programs;
      INSERT INTO programs
        (channel_id, start_ms, stop_ms, title, description, category)
      SELECT channel_id, start_ms, stop_ms, title, description, category
      FROM programs_staging;
      DELETE FROM programs_staging;
    `);
  });

  onProgress?.(1);
  return {
    programCount: written,
    channelCount: entries.filter(([, list]) => list.length > 0).length,
  };
}

export async function loadIndexedPrograms(
  channelIds: string[],
  startMs: number,
  endMs: number,
): Promise<Record<string, Program[]>> {
  const db = await openDatabase();
  const programs: Record<string, Program[]> = {};
  if (!db || !channelIds.length) return programs;

  const uniqueIds = [...new Set(channelIds.filter(Boolean))];
  // Batch query by 100 channels at a time (SQLite param limit is 999; 100 + 2 = 102 params)
  for (let offset = 0; offset < uniqueIds.length; offset += 100) {
    const ids = uniqueIds.slice(offset, offset + 100);
    const placeholders = ids.map(() => "?").join(",");
    const rows = await db.getAllAsync<ProgramRow>(
      `SELECT channel_id, start_ms, stop_ms, title, description, category
       FROM programs
       WHERE channel_id IN (${placeholders})
         AND stop_ms > ?
         AND start_ms < ?
       ORDER BY channel_id, start_ms`,
      [...ids, startMs, endMs],
    );
    for (const row of rows) {
      (programs[row.channel_id] ||= []).push({
        title: row.title,
        desc: row.description || "",
        category: row.category || "",
        start: new Date(row.start_ms).toISOString(),
        stop: new Date(row.stop_ms).toISOString(),
      });
    }
    await nextTick();
  }
  return programs;
}

export async function getIndexedEpgStats(): Promise<EpgDbStats> {
  const db = await openDatabase();
  if (!db) return { programCount: 0, channelCount: 0 };
  const row = await db.getFirstAsync<{ program_count: number; channel_count: number }>(
    "SELECT COUNT(*) AS program_count, COUNT(DISTINCT channel_id) AS channel_count FROM programs",
  );
  return {
    programCount: Number(row?.program_count || 0),
    channelCount: Number(row?.channel_count || 0),
  };
}

export async function getIndexedEpgStorageBytes(): Promise<number> {
  const db = await openDatabase();
  if (!db) return 0;
  const pageCount = await db.getFirstAsync<{ page_count: number }>("PRAGMA page_count");
  const pageSize = await db.getFirstAsync<{ page_size: number }>("PRAGMA page_size");
  return Number(pageCount?.page_count || 0) * Number(pageSize?.page_size || 0);
}

export async function clearIndexedEpg(): Promise<void> {
  const db = await openDatabase();
  if (db) await db.execAsync("DELETE FROM programs; DELETE FROM programs_staging; PRAGMA wal_checkpoint(TRUNCATE);");
}
