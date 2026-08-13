import React, { createContext, startTransition, useCallback, useContext, useEffect, useRef, useState, useMemo } from "react";
import { Platform } from "react-native";
import dayjs from "dayjs";
import { storage } from "@/src/utils/storage";
import { Channel, Program } from "@/src/api";
import {
  loadGuide,
  loadGuideProgramsForChannelIds,
  refreshEpgOnly,
  refreshSource,
  retainProgrammeWindowCache,
  setManualEpgRemaps,
  setPreferTvgIdOnlyMatching,
  setProgrammeWindowCacheLimit,
  trimProgrammeWindowCacheForMemoryPressure,
  subscribeSource,
} from "@/src/source";
import { isGuideSurfing, onGuideSurfSettled } from "@/src/utils/guideSurfGate";
import {
  applyGuidePrograms,
  getGuidePrograms,
  makeGuideProgramWindowKey,
  retainGuidePrograms,
  setGuideProgramRowLimit,
  trimGuideProgramRows,
} from "@/src/core/guideProgramsStore";
import { pickKeepIdsAroundFocus } from "@/src/core/guideSlidingCache";
import { buildGuidePatchTiers, keepUsefulGuidePatch } from "@/src/core/guidePatchPolicy";
import { reminderKey, setTimeFormat24h } from "@/src/utils/time";
import { subscribeAndroidMemoryPressure } from "@/src/utils/androidMemoryPressure";
import { clearChannelLogoMemory } from "@/src/components/ChannelLogo";
import { sanitizeFavoriteIds, toggleFavoriteId } from "@/src/utils/favoriteIds";
import { pushRecentId, sanitizeRecentIds } from "@/src/utils/recentIds";
import { sanitizeReminders } from "@/src/utils/reminderIds";
import { remapStoredChannelIds } from "@/src/utils/channelIdentityMigrate";
import { getPowerProfileTuning, resolvePowerProfile, type PowerProfile } from "@/src/core/devicePowerProfile";
import { resolveStoredGuideLayout } from "@/src/core/guideLayoutDefault";
import { applyManualEpgRemaps, resolveEpgGuideFilter, sanitizeEpgManualRemap, type EpgGuideFilter } from "@/src/core/epgUserOverrides";
import {
  createFavoriteFolder,
  DEFAULT_FOLDER_PRESETS,
  renameFavoriteFolder,
  sanitizeFavoriteFolders,
  toggleChannelInFolder,
  type FavoriteFolder,
} from "@/src/core/favoriteFolders";
import {
  cancelReminder,
  requestNotificationPermission,
  scheduleProgramReminder,
} from "@/src/utils/notifications";

const FAV_KEY = "gs_favorites";
const RECENT_KEY = "gs_recent";
const LAST_CHANNEL_KEY = "gs_last_channel";
const REM_KEY = "gs_reminders";
const PMODE_KEY = "gs_pointer_mode";
const GUIDE_LAYOUT_KEY = "gs_guide_layout";
const GUIDE_DENSITY_KEY = "gs_guide_density";
const EXTRA_COMPACT_DEFAULT_MIGRATION_KEY = "gs_extra_compact_default_v1";
const SAFE_PREVIEW_MODE_KEY = "gs_safe_preview_mode";
const CHANNEL_NUMBERS_KEY = "gs_channel_numbers";
const CHANNEL_LOGOS_KEY = "gs_channel_logos";
const DEVICE_LAYOUT_MODE_KEY = "gs_device_layout_mode";
const PLAYER_TIMEOUT_KEY = "gs_player_timeout_ms";
const AUTO_RETRY_KEY = "gs_auto_retry_streams";
const PREFER_TVG_ID_ONLY_KEY = "gs_prefer_tvg_id_only";
const POWER_PROFILE_KEY = "gs_power_profile";
const LOGOS_OFF_SURF_KEY = "gs_logos_off_while_surfing";
const EPG_GUIDE_FILTER_KEY = "gs_epg_guide_filter";
const EPG_MANUAL_REMAPS_KEY = "gs_epg_manual_remaps";
const FAVORITE_FOLDERS_KEY = "gs_favorite_folders";
const FAVORITE_FOLDERS_SEEDED_KEY = "gs_favorite_folders_seeded";
const GUIDE_WINDOW_HOURS_KEY = "gs_guide_window_hours";
const CLOCK_24H_KEY = "gs_clock_24h";
const START_SCREEN_KEY = "gs_start_screen";
const SLEEP_TIMER_MINUTES_KEY = "gs_sleep_timer_minutes";
const INSTANT_GUIDE_KEY = "gs_instant_guide";

const DEFAULT_GUIDE_WINDOW_HOURS = readGuideWindowHours(process.env.EXPO_PUBLIC_GUIDE_WINDOW_HOURS, 6);

function readGuideWindowHours(value: string | number | null | undefined, fallback: GuideWindowHours): GuideWindowHours {
  const n = Number(value || fallback);
  if (n === 6 || n === 8 || n === 12 || n === 24) return n;
  return fallback;
}

function resolveStartScreen(value: string | null | undefined): StartScreen {
  if (value === "guide" || value === "last_channel" || value === "home") return value;
  return "home";
}

function resolveSleepTimerMinutes(value: unknown): SleepTimerMinutes {
  const n = Number(value);
  if (n === 15 || n === 30 || n === 60 || n === 90) return n;
  return 0;
}

export type GuideLayout = "cinematic" | "compact";
export type GuideDensity = "large" | "normal" | "compact" | "extra_compact";
export type SafePreviewMode = "on" | "delayed" | "surf" | "off";
export type DeviceLayoutMode = "auto" | "tv" | "mobile";
export type PlayerControlsTimeoutMs = 8000 | 15000 | 30000 | 60000;
export type GuideWindowHours = 6 | 8 | 12 | 24;
export type StartScreen = "home" | "guide" | "last_channel";
export type SleepTimerMinutes = 0 | 15 | 30 | 60 | 90;
export type { EpgGuideFilter, FavoriteFolder, PowerProfile };

export type Reminder = {
  key: string;
  notificationId: string;
  channelId: string;
  channelName: string;
  channelLogo?: string | null;
  programTitle: string;
  programDesc?: string;
  start: string;
  stop: string | null;
};

export type ReminderToggleResult = "added" | "removed" | "failed";

export type ActiveProgram = { program: Program; channel: Channel } | null;

export type Store = {
  channels: Channel[];
  windowStart: string;
  windowEnd: string;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: (silent?: boolean) => Promise<void>;
  hardRefresh: () => Promise<void>;
  /** Fetch/attach programmes for a viewport ring without a full guide rebuild. */
  patchProgramsForChannelIds: (channelIds: string[], priorityIds?: string[]) => Promise<void>;
  /** Conveyor-belt eviction â€” keep only the hysteresis band around the runway. */
  retainGuideSlidingCache: (keepIds: Iterable<string>) => void;
  /** Release off-screen Guide rows before fullscreen playback keeps decoders alive. */
  releaseGuideSlidingCache: () => void;
  selectedDate: string;
  setSelectedDate: (d: string) => void;
  channelById: (id: string) => Channel | undefined;

  favorites: string[];
  isFavorite: (id: string) => boolean;
  toggleFavorite: (id: string) => void;
  replaceFavorites: (ids: string[]) => void;

  /** Resolved live channels for recent IDs (never fat persisted program payloads). */
  recent: Channel[];
  recentIds: string[];
  lastChannelId: string | null;
  addRecent: (c: Channel) => void;

  reminders: Reminder[];
  hasReminder: (key: string) => boolean;
  addReminder: (program: Program, channel: Channel) => Promise<boolean>;
  removeReminder: (key: string) => Promise<void>;
  /** Single reminder mutation path shared by Guide preview and ProgramModal. */
  toggleReminder: (program: Program, channel: Channel) => Promise<ReminderToggleResult>;

  activeProgram: ActiveProgram;
  openProgram: (program: Program, channel: Channel) => void;
  closeProgram: () => void;

  pointerMode: boolean;
  setPointerMode: (v: boolean) => void;

  guideLayout: GuideLayout;
  setGuideLayout: (v: GuideLayout) => void;
  guideDensity: GuideDensity;
  setGuideDensity: (v: GuideDensity) => void;
  safePreviewMode: SafePreviewMode;
  setSafePreviewMode: (v: SafePreviewMode) => void;
  channelNumbers: boolean;
  setChannelNumbers: (v: boolean) => void;
  channelLogos: boolean;
  setChannelLogos: (v: boolean) => void;
  deviceLayoutMode: DeviceLayoutMode;
  setDeviceLayoutMode: (v: DeviceLayoutMode) => void;
  playerControlsTimeoutMs: PlayerControlsTimeoutMs;
  setPlayerControlsTimeoutMs: (v: PlayerControlsTimeoutMs) => void;
  autoRetryStreams: boolean;
  setAutoRetryStreams: (v: boolean) => void;
  preferTvgIdOnly: boolean;
  setPreferTvgIdOnly: (v: boolean) => void;
  powerProfile: PowerProfile;
  setPowerProfile: (v: PowerProfile) => void;
  logosOffWhileSurfing: boolean;
  setLogosOffWhileSurfing: (v: boolean) => void;
  instantGuide: boolean;
  setInstantGuide: (v: boolean) => void;
  epgGuideFilter: EpgGuideFilter;
  setEpgGuideFilter: (v: EpgGuideFilter) => void;
  epgManualRemaps: Record<string, string>;
  setEpgManualRemaps: (v: Record<string, string>) => void;
  favoriteFolders: FavoriteFolder[];
  setFavoriteFolders: (folders: FavoriteFolder[]) => void;
  addFavoriteFolder: (name: string) => FavoriteFolder | null;
  toggleFavoriteFolderChannel: (folderId: string, channelId: string) => void;
  renameFavoriteFolder: (folderId: string, name: string) => void;
  removeFavoriteFolder: (id: string) => void;
  guideWindowHours: GuideWindowHours;
  setGuideWindowHours: (v: GuideWindowHours) => void;
  clock24h: boolean;
  setClock24h: (v: boolean) => void;
  startScreen: StartScreen;
  setStartScreen: (v: StartScreen) => void;
  sleepTimerMinutes: SleepTimerMinutes;
  setSleepTimerMinutes: (v: SleepTimerMinutes) => void;
};

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const c = useContext(Ctx);
  if (!c) throw new Error("useStore must be used inside GuideProvider");
  return c;
}

export function GuideProvider({ children }: { children: React.ReactNode }) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [windowStart, setWindowStart] = useState("");
  const [windowEnd, setWindowEnd] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDateState] = useState(dayjs().format("YYYY-MM-DD"));
  const dateRef = useRef(selectedDate);
  const refreshRequestRef = useRef(0);
  const refreshSilentRef = useRef<(silent?: boolean) => Promise<void>>(async () => undefined);
  const pendingSilentRefreshRef = useRef(false);
  const patchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const patchInFlightRef = useRef(false);
  const pendingPatchIdsRef = useRef(new Set<string>());
  const pendingPatchPriorityIdsRef = useRef<string[]>([]);
  const lastPatchRunwayIdsRef = useRef<string[]>([]);
  /** Expanded conveyor keep set (Â± hysteresis). Prefer this over raw runway on retain. */
  const lastKeepIdsRef = useRef<string[]>([]);
  const windowStartRef = useRef("");
  const windowEndRef = useRef("");
  const guideEpochRef = useRef(0);

  const [favorites, setFavorites] = useState<string[]>([]);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [lastChannelId, setLastChannelId] = useState<string | null>(null);
  const lastChannelIdRef = useRef<string | null>(null);
  lastChannelIdRef.current = lastChannelId;
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const remindersRef = useRef<Reminder[]>([]);
  const reminderDesiredStateRef = useRef(new Map<string, boolean>());
  const reminderMutationRef = useRef(new Map<string, Promise<ReminderToggleResult>>());
  // Keep ref in sync during render so async add/remove see the latest list immediately
  // (useEffect would lag one frame and break hasReminder after setReminders).
  remindersRef.current = reminders;
  const remindersSet = useMemo(() => new Set(reminders.map((r) => r.key)), [reminders]);

  const [activeProgram, setActiveProgram] = useState<ActiveProgram>(null);
  const [pointerMode, setPointerModeState] = useState(false);
  const [guideLayout, setGuideLayoutState] = useState<GuideLayout>(() =>
    resolveStoredGuideLayout(null, Platform.isTV, Platform.OS),
  );
  const [guideDensity, setGuideDensityState] = useState<GuideDensity>("extra_compact");
  const [safePreviewMode, setSafePreviewModeState] = useState<SafePreviewMode>("surf");
  const [channelNumbers, setChannelNumbersState] = useState(false);
  const [channelLogos, setChannelLogosState] = useState(true);
  const [deviceLayoutMode, setDeviceLayoutModeState] = useState<DeviceLayoutMode>("auto");
  const [playerControlsTimeoutMs, setPlayerControlsTimeoutMsState] = useState<PlayerControlsTimeoutMs>(8000);
  const [autoRetryStreams, setAutoRetryStreamsState] = useState(true);
  const [preferTvgIdOnly, setPreferTvgIdOnlyState] = useState(false);
  const [powerProfile, setPowerProfileState] = useState<PowerProfile>("normal");
  const [logosOffWhileSurfing, setLogosOffWhileSurfingState] = useState(getPowerProfileTuning("normal").logosOffWhileSurfingDefault);
  const [instantGuide, setInstantGuideState] = useState(true);
  useEffect(() => {
    const limit = getPowerProfileTuning(powerProfile).programmeRowCacheLimit;
    setGuideProgramRowLimit(limit);
    setProgrammeWindowCacheLimit(limit);
  }, [powerProfile]);
  useEffect(
    () => subscribeAndroidMemoryPressure((pressure) => {
      const critical = pressure === "critical";
      // Mounted Guide rows are protected by subscriptions; SQLite/user data are
      // never touched by Android memory-pressure cleanup. Prefer the expanded
      // hysteresis keep set (focus-centered) over the raw runway head.
      const source = lastKeepIdsRef.current.length
        ? lastKeepIdsRef.current
        : lastPatchRunwayIdsRef.current;
      const keepLimit = critical
        ? powerProfile === "weak" ? 8 : powerProfile === "max_preview" ? 16 : 12
        : powerProfile === "weak" ? 16 : powerProfile === "max_preview" ? 48 : 32;
      const keep = pickKeepIdsAroundFocus(source, keepLimit, lastChannelIdRef.current);
      if (critical) {
        // Replace both source runways before strict eviction. An in-flight SQL
        // result is filtered against these refs when it returns, so it cannot
        // repopulate the larger pre-pressure window.
        lastPatchRunwayIdsRef.current = keep;
        lastKeepIdsRef.current = keep;
        pendingPatchIdsRef.current.clear();
        pendingPatchPriorityIdsRef.current = [];
        if (patchTimerRef.current) {
          clearTimeout(patchTimerRef.current);
          patchTimerRef.current = null;
        }
        retainGuidePrograms(keep, { force: true });
        retainProgrammeWindowCache(keep);
      }
      trimGuideProgramRows(keep, critical);
      trimProgrammeWindowCacheForMemoryPressure(keep, critical);
      clearChannelLogoMemory();
    }),
    [powerProfile],
  );
  const [epgGuideFilter, setEpgGuideFilterState] = useState<EpgGuideFilter>("all");
  const [epgManualRemaps, setEpgManualRemapsState] = useState<Record<string, string>>({});
  const epgManualRemapsRef = useRef<Record<string, string>>({});
  epgManualRemapsRef.current = epgManualRemaps;
  const [favoriteFolders, setFavoriteFoldersState] = useState<FavoriteFolder[]>([]);
  const [guideWindowHours, setGuideWindowHoursState] = useState<GuideWindowHours>(DEFAULT_GUIDE_WINDOW_HOURS);
  const guideWindowHoursRef = useRef<GuideWindowHours>(DEFAULT_GUIDE_WINDOW_HOURS);
  const [clock24h, setClock24hState] = useState(false);
  const [startScreen, setStartScreenState] = useState<StartScreen>("home");
  const [sleepTimerMinutes, setSleepTimerMinutesState] = useState<SleepTimerMinutes>(0);

  // Memoized helpers for fast lookups
  const channelByIdMap = useMemo(() => {
    const m = new Map<string, Channel>();
    for (const c of channels) m.set(c.id, c);
    return m;
  }, [channels]);

  const favoritesSet = useMemo(() => new Set(favorites), [favorites]);

  // Resolve recent IDs against the live channel list â€” never keïM<¶‰žËkºwµçAÑ¡”¹•áÐÉ½ÝÌÁ½ÁÕ±…Ñ•Ý¡¥±”Ñ¡”­•ä¥Ì¡•±¸(€€€Á…Ñ¡Q¥µ•ÉI•˜¹ÕÉÉ•¹Ð€ôÍ•ÑQ¥µ•½ÕÐ  ¤€ôøì(€€€€€Á…Ñ¡Q¥µ•ÉI•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€Ù½¥™±ÕÍ¡AÉ½É…µA…Ñ¡EÕ•Õ” ¤ì(€€€ô°¥ÍÕ¥‘•MÕÉ™¥¹œ ¤€ü€ÄØ€è€ÌÈ¤ì(€ô°m™±ÕÍ¡AÉ½É…µA…Ñ¡EÕ•Õ•t¤ì((€€¼¨¨(€€€¨‘Ù…¹”Ñ¡”½¹Ù•å½Èµ‰•±Ð­••ÀÍ•Ðè‘É½À)L€¬¹…Ñ¥Ù”ÁÉ½É…µµ”É½ÝÌÑ¡…Ð(€€€¨±•™ÐÑ¡”¡åÍÑ•É•Í¥Ì‰…¹Í¼¡•±ÍÕÉ™¥¹œ…¹¹½Ð…ÕµÕ±…Ñ”Ñ¡”Á±…å±¥ÍÐ¸(€€€¨¼(€½¹ÍÐÉ•Ñ…¥¹Õ¥‘•M±¥‘¥¹…¡”€ôÕÍ•…±±‰…¬ ¡­••Á%‘Ìè%Ñ•É…‰±”ñÍÑÉ¥¹œø¤€ôøì(€€€½¹ÍÐ­••À€ôÉÉ…ä¹™É½´¡­••Á%‘Ì¤¹™¥±Ñ•È¡	½½±•…¸¤ì(€€€¥˜€ …­••À¹±•¹Ñ ¤É•ÑÕÉ¸ì(€€€±…ÍÑ-••Á%‘ÍI•˜¹ÕÉÉ•¹Ð€ô­••Àì(€€€É•Ñ…¥¹Õ¥‘•AÉ½É…µÌ¡­••À¤ì(€€€É•Ñ…¥¹AÉ½É…µµ•]¥¹‘½Ý…¡”¡­••À¤ì(€ô°mt¤ì((€½¹ÍÐÉ•±•…Í•Õ¥‘•M±¥‘¥¹…¡”€ôÕÍ•…±±‰…¬  ¤€ôøì(€€€€¼¼AÉ•Í•ÉÙ”„Íµ…±°Ý…É´ÉÕ¹Ý…ä™½È„™…ÍÐÉ•ÑÕÉ¸Ñ¼Õ¥‘”Ý¡¥±”É•±•…Í¥¹œ(€€€€¼¼Ñ¡”‰Õ±¬½˜ÁÉ½É…µµ”…ÉÉ…åÌ‰•™½É”™Õ±±ÍÉ••¸Ù¥‘•¼‘•½‘•ÉÌÍÑ…ÉÐ¸(€€€€¼¼…À…É½Õ¹±…ÍÑ¡…¹¹•±%ƒŠPÍ±¥¥¹œÑ¡”…Í•¹‘¥¹œ­••À¡•…‘É½ÁÌ™½ÕÌ¸(€€€½¹ÍÐ­••Á1¥µ¥Ð€ôÁ½Ý•ÉAÉ½™¥±”€ôôô€‰Ý•…¬ˆ€ü€ÈÐ€èÁ½Ý•ÉAÉ½™¥±”€ôôô€‰µ…á}ÁÉ•Ù¥•Üˆ€ü€ÜÈ€è€Ðàì(€€€½¹ÍÐÍ½ÕÉ”€ô±…ÍÑ-••Á%‘ÍI•˜¹ÕÉÉ•¹Ð¹±•¹Ñ (€€€€€€ü±…ÍÑ-••Á%‘ÍI•˜¹ÕÉÉ•¹Ð(€€€€€€è±…ÍÑA…Ñ¡IÕ¹Ý…å%‘ÍI•˜¹ÕÉÉ•¹Ðì(€€€½¹ÍÐ­••À€ôÁ¥­-••Á%‘ÍÉ½Õ¹‘½ÕÌ¡Í½ÕÉ”°­••Á1¥µ¥Ð°±…ÍÑ¡…¹¹•±%¤ì(€€€±…ÍÑA…Ñ¡IÕ¹Ý…å%‘ÍI•˜¹ÕÉÉ•¹Ð€ô­••Àì(€€€±…ÍÑ-••Á%‘ÍI•˜¹ÕÉÉ•¹Ð€ô­••Àì(€€€Á•¹‘¥¹A…Ñ¡%‘ÍI•˜¹ÕÉÉ•¹Ð¹±•…È ¤ì(€€€Á•¹‘¥¹A…Ñ¡AÉ¥½É¥Ñå%‘ÍI•˜¹ÕÉÉ•¹Ð€ômtì(€€€¥˜€¡Á…Ñ¡Q¥µ•ÉI•˜¹ÕÉÉ•¹Ð¤ì(€€€€€±•…ÉQ¥µ•½ÕÐ¡Á…Ñ¡Q¥µ•ÉI•˜¹ÕÉÉ•¹Ð¤ì(€€€€€Á…Ñ¡Q¥µ•ÉI•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€ô(€€€€¼¼MÑÉ¥ÐÉ•Ñ…¥¸™¥ÉÍÐÍ¼‰±ÕÈ…¹¹½Ð±•…Ù”¡Õ¹‘É•‘Ì½˜½™˜µÉÕ¹Ý…äÉ½ÝÌÝ…É´¸(€€€€¼¼½É”•µÁÑ¥•ÌÍÕ‰ÍÉ¥‰•½™˜µ­••ÀÉ½ÝÌƒŠP±…Í¡1¥ÍÐµ…äÍÑ¥±°‰”µ½Õ¹Ñ•¸(€€€É•Ñ…¥¹Õ¥‘•AÉ½É…µÌ¡­••À°ì™½É”èÑÉÕ”ô¤ì(€€€É•Ñ…¥¹AÉ½É…µµ•]¥¹‘½Ý…¡”¡­••À¤ì(€€€ÑÉ¥µÕ¥‘•AÉ½É…µI½ÝÌ¡­••À°ÑÉÕ”¤ì(€€€ÑÉ¥µAÉ½É…µµ•]¥¹‘½Ý…¡•½É5•µ½ÉåAÉ•ÍÍÕÉ”¡­••À°ÑÉÕ”¤ì(€€€±•…É¡…¹¹•±1½½5•µ½Éä ¤ì(€ô°m±…ÍÑ¡…¹¹•±%°Á½Ý•ÉAÉ½™¥±•t¤ì((€½¹ÍÐÍ•ÑM•±•Ñ•‘…Ñ”€ôÕÍ•…±±‰…¬ (€€€€¡èÍÑÉ¥¹œ¤€ôøì(€€€€€‘…Ñ•I•˜¹ÕÉÉ•¹Ð€ôì(€€€€€Í•ÑM•±•Ñ•‘…Ñ•MÑ…Ñ”¡¤ì(€€€€€É•™É•Í  ¤ì(€€€ô°(€€€mÉ•™É•Í¡t°(€€¤ì((€½¹ÍÐ¡…É‘I•™É•Í €ôÕÍ•…±±‰…¬¡…Íå¹Œ€ ¤€ôøì(€€€Í•ÑI•™É•Í¡¥¹œ¡ÑÉÕ”¤ì(€€€ÑÉäì(€€€€€…Ý…¥ÐÉ•™É•Í¡M½ÕÉ”¡ÑÉÕ”¤ì(€€€€€…Ý…¥ÐÉ•™É•Í ¡ÑÉÕ”¤ì(€€€ô…Ñ €¡”¤ì(€€€€€½¹Í½±”¹Ý…É¸ ‰¡…É‘I•™É•Í •ÉÉ½Èèˆ°”¤ì(€€€ô(€€€Í•ÑI•™É•Í¡¥¹œ¡™…±Í”¤ì(€ô°mÉ•™É•Í¡t¤ì((€ÕÍ•™™•Ð  ¤€ôøì(€€€±•Ð‘¥ÍÁ½Í•€ô™…±Í”ì(€€€±•Ð¡•…±Ñ¡Q¥µ•ÈèI•ÑÕÉ¹QåÁ”ñÑåÁ•½˜Í•ÑQ¥µ•½ÕÐøð¹Õ±°€ô¹Õ±°ì(€€€Ù½¥€¡…Íå¹Œ€ ¤€ôøì(€€€€€½¹ÍÐÉ…Ý…Ù½É¥Ñ•Ì€ô…Ý…¥ÐÍÑ½É…”¹•Ñ%Ñ•´ñÕ¹­¹½Ý¸ø¡Y}-d°mt¤ì(€€€€€½¹ÍÐ±•…¹•‘…Ù½É¥Ñ•Ì€ôÍ…¹¥Ñ¥é•…Ù½É¥Ñ•%‘Ì¡É…Ý…Ù½É¥Ñ•Ì¤ì(€€€€€Í•Ñ…Ù½É¥Ñ•Ì¡±•…¹•‘…Ù½É¥Ñ•Ì¤ì(€€€€€€¼¼I•ÝÉ¥Ñ”½µÁ…Ñ•%µ½¹±ä±¥ÍÐ¥˜½±‘•È½™…ÑÑ•È‘…Ñ„Ý…ÌÍÑ½É•¸(€€€€€¥˜€¡)M=8¹ÍÑÉ¥¹¥™ä¡É…Ý…Ù½É¥Ñ•Ì¤€„ôô)M=8¹ÍÑÉ¥¹¥™ä¡±•…¹•‘…Ù½É¥Ñ•Ì¤¤ì(€€€€€€€Ù½¥ÍÑ½É…”¹Í•Ñ%Ñ•´¡Y}-d°±•…¹•‘…Ù½É¥Ñ•Ì¤ì(€€€€€ô(€€€€€½¹ÍÐÉ…ÝI••¹Ð€ô…Ý…¥ÐÍÑ½É…”¹•Ñ%Ñ•´ñÕ¹­¹½Ý¸ø¡I9Q}-d°mt¤ì(€€€€€½¹ÍÐ±•…¹•‘I••¹Ð€ôÍ…¹¥Ñ¥é•I••¹Ñ%‘Ì¡É…ÝI••¹Ð¤ì(€€€€€Í•ÑI••¹Ñ%‘Ì¡±•…¹•‘I••¹Ð¤ì(€€€€€¥˜€¡)M=8¹ÍÑÉ¥¹¥™ä¡É…ÝI••¹Ð¤€„ôô)M=8¹ÍÑÉ¥¹¥™ä¡±•…¹•‘I••¹Ð¤¤ì(€€€€€€€Ù½¥ÍÑ½É…”¹Í•Ñ%Ñ•´¡I9Q}-d°±•…¹•‘I••¹Ð¤ì(€€€€€ô(€€€€€Í•Ñ1…ÍÑ¡…¹¹•±%¡…Ý…¥ÐÍÑ½É…”¹•Ñ%Ñ•´ñÍÑÉ¥¹œð¹Õ±°ø¡1MQ}!991}-d°¹Õ±°¤¤ì(€€€€€Í•ÑI•µ¥¹‘•ÉÌ¡Í…¹¥Ñ¥é•I•µ¥¹‘•ÉÌ ¡…Ý…¥ÐÍÑ½É…”¹•Ñ%Ñ•´ñI•µ¥¹‘•Émtø¡I5}-d°mt¤¤ñðmt¤…ÌI•µ¥¹‘•Émt¤ì(€€€€€Í•ÑA½¥¹Ñ•É5½‘•MÑ…Ñ” ¡…Ý…¥ÐÍÑ½É…”¹•Ñ%Ñ•´ñ‰½½±•…¸ø¡A5=}-d°™…±Í”¤¤ñð™…±Í”¤ì(€€€€€½¹ÍÐÍÑ½É•‘Õ¥‘•1…å½ÕÐ€ô…Ý…¥ÐÍÑ½É…”¹•Ñ%Ñ•´ñÍÑÉ¥¹œð¹Õ±°ø¡U%}1e=UQ}-d°¹Õ±°¤ì(€€€€€Í•ÑÕ¥‘•1…å½ÕÑMÑ…Ñ”¡É•Í½±Ù•MÑ½É•‘Õ¥‘•1…å½ÕÐ¡ÍÑ½É•‘Õ¥‘•1…å½ÕÐ°A±…Ñ™½É´¹¥ÍQX°A±…Ñ™½É´¹=L¤¤ì(€€€€€½¹ÍÐ•áÑÉ…½µÁ…Ñ•™…Õ±ÑÁÁ±¥•€ô…Ý…¥ÐÍÑ½É…”¹•Ñ%Ñ•´ñ‰½½±•…¸ø¡aQI}=5AQ}U1Q}5%IQ%=9}-d°™…±Í”¤ì(€€€€€½¹ÍÐÍÑ½É•‘•¹Í¥Ñä€ô•áÑÉ…½µÁ…Ñ•™…Õ±ÑÁÁ±¥•(€€€€€€€€ü…Ý…¥ÐÍÑ½É…”¹•Ñ%Ñ•´ñÕ¥‘••¹Í¥Ñäø¡U%}9M%Qe}-d°€‰•áÑÉ…}½µÁ…Ðˆ¤(€€€€€€€€è€‰•áÑÉ…}½µÁ…Ðˆì(€€€€€Í•ÑÕ¥‘••¹Í¥ÑåMÑ…Ñ” (€€€€€€€ÍÑ½É•‘•¹Í¥Ñä€ôôô€‰±…É”ˆñðÍÑ½É•‘•¹Í¥Ñä€ôôô€‰¹½Éµ…°ˆñðÍÑ½É•‘•¹Í¥Ñä€ôôô€‰½µÁ…Ðˆ(€€€€€€€€€€üÍÑ½É•‘•¹Í¥Ñä(€€€€€€€€€€è€‰•áÑÉ…}½µÁ…Ðˆ°(€€€€€€¤ì(€€€€€¥˜€ …•áÑÉ…½µÁ…Ñ•™…Õ±ÑÁÁ±¥•¤ì(€€€€€€€Ù½¥ÍÑ½É…”¹Í•Ñ%Ñ•´¡U%}9M%Qe}-d°€‰•áÑÉ…}½µÁ…Ðˆ¤ì(€€€€€€€Ù½¥ÍÑ½É…”¹Í•Ñ%Ñ•´¡aQI}=5AQ}U1Q}5%IQ%=9}-d°ÑÉÕ”¤ì(€€€€€ô(€€€€€Í•ÑM…™•AÉ•Ù¥•Ý5½‘•MÑ…Ñ” ¡…Ý…¥ÐÍÑ½É…”¹•Ñ%Ñ•´ñM…™•AÉ•Ù¥•Ý5½‘”ø¡M}AIY%]}5=}-d°€‰ÍÕÉ˜ˆ¤¤ñð€‰ÍÕÉ˜ˆ¤ì(€€€€€Í•Ñ¡…¹¹•±9Õµ‰•ÉÍMÑ…Ñ” ¡…Ý…¥ÐÍÑ½É…”¹•Ñ%Ñ•´ñ‰½½±•…¸ø¡!991}9U5	IM}-d°™…±Í”¤¤ñð™…±Í”¤ì(€€€€€Í•Ñ¡…¹¹•±1½½ÍMÑ…Ñ” ¡…Ý…¥ÐÍÑ½É…”¹•Ñ%Ñ•´ñ‰½½±•…¸ø¡!991}1==M}-d°ÑÉÕ”¤¤€üüÑÉÕ”¤ì(€€€€€Í•Ñ•Ù¥•1…å½ÕÑ5½‘•MÑ…Ñ” ¡…Ý…¥ÐÍÑ½É…”¹•Ñ%Ñ•´ñ•Ù¥•1…å½ÕÑ5½‘”ø¡Y%}1e=UQ}5=}-d°€‰…ÕÑ¼ˆ¤¤ñð€‰…ÕÑ¼ˆ¤ì(€€€€€Í•ÑA±…å•É½¹ÑÉ½±ÍQ¥µ•½ÕÑ5ÍMÑ…Ñ” ¡…Ý…¥ÐÍÑ½É…”¹•Ñ%Ñ•´ñA±…å•É½¹ÑÉ½±ÍQ¥µ•½ÕÑ5Ìø¡A1eI}Q%5=UQ}-d°€àÀÀÀ¤¤ñð€àÀÀÀ¤ì(€€€€€Í•ÑÕÑ½I•ÑÉåMÑÉ•…µÍMÑ…Ñ” ¡…Ý…¥ÐÍÑ½É…”¹•Ñ%Ñ•´ñ‰½½±•…¸ø¡UQ=}IQIe}-d°ÑÉÕ”¤¤€üüÑÉÕ”¤ì(€€€€€½¹ÍÐÑÙ=¹±ä€ô€¡…Ý…¥ÐÍÑ½É…”¹•Ñ%Ñ•´ñ‰½½±•…¸ø¡AII}QY}%}=91e}-d°™…±Í”¤¤ñð™…±Í”ì(€€€€€Í•ÑAÉ•™•ÉQÙ%‘=¹±åMÑ…Ñ”¡ÑÙ=¹±ä¤ì(€€€€€Í•ÑAÉ•™•ÉQÙ%‘=¹±å5…Ñ¡¥¹œ¡ÑÙ=¹±ä¤ì(€€€€€½¹ÍÐÁÉ½™¥±”€ôÉ•Í½±Ù•A½Ý•ÉAÉ½™¥±”¡…Ý…¥ÐÍÑ½É…”¹•Ñ%Ñ•´ñÍÑÉ¥¹œø¡A=]I}AI=%1}-d°€‰¹½Éµ…°ˆ¤¤ì(€€€€€Í•ÑA½Ý•ÉAÉ½™¥±•MÑ…Ñ”¡ÁÉ½™¥±”¤ì(€€€€€½¹ÍÐÉ…Ý1½½Í=™™]¡¥±•MÕÉ™¥¹œ€ô…Ý…¥ÐÍÑ½É…”¹•Ñ%Ñ•´ñ‰½½±•…¸ð¹Õ±°ø¡1==M}=}MUI}-d°¹Õ±°¤ì(€€€€€Í•Ñ1½½Í=™™]¡¥±•MÕÉ™¥¹MÑ…Ñ” (€€€€€€€ÑåÁ•½˜É…Ý1½½Í=™™]¡¥±•MÕÉ™¥¹œ€ôôô€‰‰½½±•…¸ˆ(€€€€€€€€€€üÉ…Ý1½½Í=™™]¡¥±•MÕÉ™¥¹œ(€€€€€€€€€€è•ÑA½Ý•ÉAÉ½™¥±•QÕ¹¥¹œ¡ÁÉ½™¥±”¤¹±½½Í=™™]¡¥±•MÕÉ™¥¹•™…Õ±Ð°(€€€€€€¤ì(€€€€€Í•Ñ%¹ÍÑ…¹ÑÕ¥‘•MÑ…Ñ” ¡…Ý…¥ÐÍÑ½É…”¹•Ñ%Ñ•´ñ‰½½±•…¸ø¡%9MQ9Q}U%}-d°ÑÉÕ”¤¤€üüÑÉÕ”¤ì(€€€€€Í•ÑÁÕ¥‘•¥±Ñ•ÉMÑ…Ñ”¡É•Í½±Ù•ÁÕ¥‘•¥±Ñ•È¡…Ý…¥ÐÍÑ½É…”¹•Ñ%Ñ•´ñÍÑÉ¥¹œø¡A}U%}%1QI}-d°€‰…±°ˆ¤¤¤ì(€€€€€½¹ÍÐµ…¹Õ…±I•µ…ÁÌ€ôÍ…¹¥Ñ¥é•Á5…¹Õ…±I•µ…À¡…Ý…¥ÐÍÑ½É…”¹•Ñ%Ñ•´ñI•½ÉñÍÑÉ¥¹œ°ÍÑÉ¥¹œøø¡A}59U1}I5AM}-d°íô¤¤ì(€€€€€Í•ÑÁ5…¹Õ…±I•µ…ÁÍMÑ…Ñ”¡µ…¹Õ…±I•µ…ÁÌ¤ì(€€€€€Í•Ñ5…¹Õ…±ÁI•µ…ÁÌ¡µ…¹Õ…±I•µ…ÁÌ¤ì(€€€€€€¼¼M••ÕÍ•™Õ°QX™½±‘•ÈÁÉ•Í•ÑÌ½¹”€¡•Ù•¸¥˜Ñ¡”ÕÍ•È±…Ñ•È‘•±•Ñ•Ì…±°™½±‘•ÉÌ¤¸(€€€€€½¹ÍÐ™½±‘•ÉÍM••‘•€ô€¡…Ý…¥ÐÍÑ½É…”¹•Ñ%Ñ•´ñ‰½½±•…¸ø¡Y=I%Q}=1IM}M}-d°™…±Í”¤¤ñð™…±Í”ì(€€€€€½¹ÍÐÍÑ½É•‘½±‘•ÉÌ€ôÍ…¹¥Ñ¥é•…Ù½É¥Ñ•½±‘•ÉÌ¡…Ý…¥ÐÍÑ½É…”¹•Ñ%Ñ•´ñ…Ù½É¥Ñ•½±‘•Émtø¡Y=I%Q}=1IM}-d°mt¤¤ì(€€€€€¥˜€ …™½±‘•ÉÍM••‘•€˜˜€…ÍÑ½É•‘½±‘•ÉÌ¹±•¹Ñ ¤ì(€€€€€€€½¹ÍÐÍ••‘•è…Ù½É¥Ñ•½±‘•Émt€ômtì(€€€€€€€™½È€¡½¹ÍÐ¹…µ”½˜U1Q}=1I}AIMQL¤ì(€€€€€€€€€½¹ÍÐ™½±‘•È€ôÉ•…Ñ•…Ù½É¥Ñ•½±‘•È¡¹…µ”°Í••‘•¤ì(€€€€€€€€€¥˜€¡™½±‘•È¤Í••‘•¹ÁÕÍ ¡™½±‘•È¤ì(€€€€€€€ô(€€€€€€€½¹ÍÐ¹•áÐ€ôÍ…¹¥Ñ¥é•…Ù½É¥Ñ•½±‘•ÉÌ¡Í••‘•¤ì(€€€€€€€Í•Ñ…Ù½É¥Ñ•½±‘•ÉÍMÑ…Ñ”¡¹•áÐ¤ì(€€€€€€€Ù½¥ÍÑ½É…”¹Í•Ñ%Ñ•´¡Y=I%Q}=1IM}-d°¹•áÐ¤ì(€€€€€€€Ù½¥ÍÑ½É…”¹Í•Ñ%Ñ•´¡Y=I%Q}=1IM}M}-d°ÑÉÕ”¤ì(€€€€€ô•±Í”ì(€€€€€€€Í•Ñ…Ù½É¥Ñ•½±‘•ÉÍMÑ…Ñ”¡ÍÑ½É•‘½±‘•ÉÌ¤ì(€€€€€€€¥˜€ …™½±‘•ÉÍM••‘•¤Ù½¥ÍÑ½É…”¹Í•Ñ%Ñ•´¡Y=I%Q}=1IM}M}-d°ÑÉÕ”¤ì(€€€€€ô(€€€€€½¹ÍÐÍÑ½É•‘Õ¥‘•]¥¹‘½Ý!½ÕÉÌ€ôÉ•…‘Õ¥‘•]¥¹‘½Ý!½ÕÉÌ (€€€€€€€…Ý…¥ÐÍÑ½É…”¹•Ñ%Ñ•´ñ¹Õµ‰•Èø¡U%}]%9=]}!=UIM}-d°U1Q}U%}]%9=]}!=UIL¤°(€€€€€€€U1Q}U%}]%9=]}!=UIL°(€€€€€€¤ì(€€€€€Õ¥‘•]¥¹‘½Ý!½ÕÉÍI•˜¹ÕÉÉ•¹Ð€ôÍÑ½É•‘Õ¥‘•]¥¹‘½Ý!½ÕÉÌì(€€€€€Í•ÑÕ¥‘•]¥¹‘½Ý!½ÕÉÍMÑ…Ñ”¡ÍÑ½É•‘Õ¥‘•]¥¹‘½Ý!½ÕÉÌ¤ì(€€€€€½¹ÍÐÍÑ½É•‘±½¬ÈÑ €ô€¡…Ý…¥ÐÍÑ½É…”¹•Ñ%Ñ•´ñ‰½½±•…¸ø¡1=-|ÈÑ!}-d°™…±Í”¤¤ñð™…±Í”ì(€€€€€Í•Ñ±½¬ÈÑ¡MÑ…Ñ”¡ÍÑ½É•‘±½¬ÈÑ ¤ì(€€€€€Í•ÑQ¥µ•½Éµ…ÐÈÑ ¡ÍÑ½É•‘±½¬ÈÑ ¤ì(€€€€€Í•ÑMÑ…ÉÑMÉ••¹MÑ…Ñ”¡É•Í½±Ù•MÑ…ÉÑMÉ••¸¡…Ý…¥ÐÍÑ½É…”¹•Ñ%Ñ•´ñÍÑÉ¥¹œø¡MQIQ}MI9}-d°€‰¡½µ”ˆ¤¤¤ì(€€€€€Í•ÑM±••ÁQ¥µ•É5¥¹ÕÑ•ÍMÑ…Ñ”¡É•Í½±Ù•M±••ÁQ¥µ•É5¥¹ÕÑ•Ì¡…Ý…¥ÐÍÑ½É…”¹•Ñ%Ñ•´ñ¹Õµ‰•Èø¡M1A}Q%5I}5%9UQM}-d°€À¤¤¤ì((€€€€€€¼¼…ÍÐÁ…¥¹Ð™É½´…¡”½¹±äƒŠP¹•Ù•È‰±½¬™¥ÉÍÐ™½ÕÌÝ¥Ñ Á•Éµ¥ÍÍ¥½¸‘¥…±½Ì(€€€€€€¼¼½ÈÍÑ…­•Í½ÕÉ”É•‰Õ¥±‘Ì€¡Ñ¡½Í”™É••é”¥É”QX™½ÕÌ½¸½Á•¸¤¸(€€€€€…Ý…¥ÐÉ•™É•Í  ¤ì(€€€€€¥˜€¡‘¥ÍÁ½Í•¤É•ÑÕÉ¸ì((€€€€€€¼¼!•…±Ñ ¡•¬…™Ñ•ÈÑ¡”U$…¸…•ÁÐµÁ…¥¹ÁÕÐ¸(€€€€€¡•…±Ñ¡Q¥µ•È€ôÍ•ÑQ¥µ•½ÕÐ  ¤€ôøì(€€€€€€€¥˜€¡‘¥ÍÁ½Í•¤É•ÑÕÉ¸ì(€€€€€€€Ù½¥€¡…Íå¹Œ€ ¤€ôøì(€€€€€€€€€ÑÉäì(€€€€€€€€€€€½¹ÍÐÍÑ…ÑÕÌ€ô…Ý…¥ÐÉ•™É•Í¡M½ÕÉ”¡™…±Í”¤ì(€€€€€€€€€€€¥˜€¡ÍÑ…ÑÕÌ¹¡…¹¹•±}½Õ¹Ð€ôôô€ÀñðÍÑ…ÑÕÌ¹•ÉÉ½È¤ì(€€€€€€€€€€€€€…Ý…¥ÐÉ•™É•Í¡M½ÕÉ”¡ÑÉÕ”¤ì(€€€€€€€€€€€€€…Ý…¥ÐÉ•™É•Í ¡ÑÉÕ”¤ì(€€€€€€€€€€€ô(€€€€€€€€€ô…Ñ ì(€€€€€€€€€€€€¼¼1•…Ù”Ñ¡”…¡•Õ¥‘”ÕÀìÕÍ•È…¸I•ÑÉä™É½´Ñ¡”Õ¥‘”ÍÉ••¸¸(€€€€€€€€€ô(€€€€€€€ô¤ ¤ì(€€€€€ô°€ÐÔÀÀ¤ì(€€€ô¤ ¤ì(€€€É•ÑÕÉ¸€ ¤€ôøì(€€€€€‘¥ÍÁ½Í•€ôÑÉÕ”ì(€€€€€¥˜€¡¡•…±Ñ¡Q¥µ•È¤±•…ÉQ¥µ•½ÕÐ¡¡•…±Ñ¡Q¥µ•È¤ì(€€€ôì(€€€€¼¼•Í±¥¹Ðµ‘¥Í…‰±”µ¹•áÐµ±¥¹”É•…Ðµ¡½½­Ì½•á¡…ÕÍÑ¥Ù”µ‘•ÁÌ(€ô°mt¤ì((€ÕÍ•™™•Ð  ¤€ôøì(€€€±•ÐÉ•™É•Í¡Q¥µ•ÈèI•ÑÕÉ¹QåÁ”ñÑåÁ•½˜Í•ÑQ¥µ•½ÕÐøð¹Õ±°€ô¹Õ±°ì(€€€±•Ð‘¥ÍÁ½Í•€ô™…±Í”ì(€€€€¼¼9…Ñ¥Ù”A•µ¥ÑÌÁ…ÉÑ¥…°€¬™¥¹…°Á¡…Í•Ì¸½…±•Í”Ñ¡•´Í¼½¹”É•™É•Í ‘½•Ì(€€€€¼¼¹½ÐÉ•‰Õ¥±•Ù•Éä¡…¹¹•°½Q¥µ•±¥¹•É¥É½ÜµÕ±Ñ¥Á±”Ñ¥µ•Ì½¸Ý•…¬ÍÑ¥­Ì¸(€€€½¹ÍÐÕ¹ÍÕ‰ÍÉ¥‰”€ôÍÕ‰ÍÉ¥‰•M½ÕÉ”  ¤€ôøì(€€€€€¥˜€¡É•™É•Í¡Q¥µ•È¤±•…ÉQ¥µ•½ÕÐ¡É•™É•Í¡Q¥µ•È¤ì(€€€€€É•™É•Í¡Q¥µ•È€ôÍ•ÑQ¥µ•½ÕÐ  ¤€ôøì(€€€€€€€É•™É•Í¡Q¥µ•È€ô¹Õ±°ì(€€€€€€€¥˜€¡‘¥ÍÁ½Í•¤É•ÑÕÉ¸ì(€€€€€€€¥˜€¡¥ÍÕ¥‘•MÕÉ™¥¹œ ¤¤ì(€€€€€€€€€Á•¹‘¥¹M¥±•¹ÑI•™É•Í¡I•˜¹ÕÉÉ•¹Ð€ôÑÉÕ”ì(€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€ô(€€€€€€€Ù½¥É•™É•Í ¡ÑÉÕ”¤ì(€€€€€ô°€ÔÀÀ¤ì(€€€ô¤ì(€€€½¹ÍÐÕ¹ÍÕ‰M•ÑÑ±”€ô½¹Õ¥‘•MÕÉ™M•ÑÑ±•  ¤€ôøì(€€€€€¥˜€¡‘¥ÍÁ½Í•ñð€…Á•¹‘¥¹M¥±•¹ÑI•™É•Í¡I•˜¹ÕÉÉ•¹Ð¤É•ÑÕÉ¸ì(€€€€€Á•¹‘¥¹M¥±•¹ÑI•™É•Í¡I•˜¹ÕÉÉ•¹Ð€ô™…±Í”ì(€€€€€Ù½¥É•™É•Í ¡ÑÉÕ”¤ì(€€€ô¤ì(€€€É•ÑÕÉ¸€ ¤€ôøì(€€€€€‘¥ÍÁ½Í•€ôÑÉÕ”ì(€€€€€¥˜€¡É•™É•Í¡Q¥µ•È¤±•…ÉQ¥µ•½ÕÐ¡É•™É•Í¡Q¥µ•È¤ì(€€€€€Õ¹ÍÕ‰ÍÉ¥‰” ¤ì(€€€€€Õ¹ÍÕ‰M•ÑÑ±” ¤ì(€€€ôì(€ô°mÉ•™É•Í¡t¤ì((€ÕÍ•™™•Ð (€€€€ ¤€ôø€ ¤€ôøì(€€€€€¥˜€¡Á…Ñ¡Q¥µ•ÉI•˜¹ÕÉÉ•¹Ð¤±•…ÉQ¥µ•½ÕÐ¡Á…Ñ¡Q¥µ•ÉI•˜¹ÕÉÉ•¹Ð¤ì(€€€€€Á•¹‘¥¹A…Ñ¡%‘ÍI•˜¹ÕÉÉ•¹Ð¹±•…È ¤ì(€€€€€Á•¹‘¥¹A…Ñ¡AÉ¥½É¥Ñå%‘ÍI•˜¹ÕÉÉ•¹Ð€ômtì(€€€€€±…ÍÑA…Ñ¡IÕ¹Ý…å%‘ÍI•˜¹ÕÉÉ•¹Ð€ômtì(€€€€€±…ÍÑ-••Á%‘ÍI•˜¹ÕÉÉ•¹Ð€ômtì(€€€€€¥˜€¡™…Ù½É¥Ñ•ÍA•ÉÍ¥ÍÑQ¥µ•È¹ÕÉÉ•¹Ð¤±•…ÉQ¥µ•½ÕÐ¡™…Ù½É¥Ñ•ÍA•ÉÍ¥ÍÑQ¥µ•È¹ÕÉÉ•¹Ð¤ì(€€€€€¥˜€¡™…Ù½É¥Ñ•ÍA•¹‘¥¹I•˜¹ÕÉÉ•¹Ð¤Ù½¥ÍÑ½É…”¹Í•Ñ%Ñ•´¡Y}-d°™…Ù½É¥Ñ•ÍA•¹‘¥¹I•˜¹ÕÉÉ•¹Ð¤ì(€€€€€¥˜€¡É••¹ÑA•ÉÍ¥ÍÑQ¥µ•È¹ÕÉÉ•¹Ð¤±•…ÉQ¥µ•½ÕÐ¡É••¹ÑA•ÉÍ¥ÍÑQ¥µ•È¹ÕÉÉ•¹Ð¤ì(€€€€€¥˜€¡É••¹ÑA•¹‘¥¹I•˜¹ÕÉÉ•¹Ð¤ì(€€€€€€€½¹ÍÐÁ…å±½…€ôÉ••¹ÑA•¹‘¥¹I•˜¹ÕÉÉ•¹Ðì(€€€€€€€Ù½¥ÍÑ½É…”¹Í•Ñ%Ñ•´¡I9Q}-d°Á…å±½…¤ì(€€€€€€€¥˜€¡Á…å±½…‘lÁt¤Ù½¥ÍÑ½É…”¹Í•Ñ%Ñ•´¡1MQ}!991}-d°Á…å±½…‘lÁt¤ì(€€€€€ô(€€€ô°(€€€mt°(€€¤ì((€€¼¼-••ÀÑ¡”Õ¥‘”Ý¥¹‘½ÜÉ½±±¥¹œÝ¡¥±”Ñ¡”…ÁÀÍÑ…åÌ½Á•¸€¡Í¥±•¹Ð°±½Ü™É•ÅÕ•¹ä¤¸(€€¼¼M­¥ÀÝ¡¥±”„É•™É•Í ¥Ì…±É•…‘äÉÕ¹¹¥¹œÍ¼Ý•…¬¥É”QYÌ‘½¸Ð¡¥Ñ µ¥µÍÕÉ˜¸(€½¹ÍÐ‰ÕÍåI•˜€ôÕÍ•I•˜¡™…±Í”¤ì(€ÕÍ•™™•Ð  ¤€ôøì(€€€‰ÕÍåI•˜¹ÕÉÉ•¹Ð€ô±½…‘¥¹œñðÉ•™É•Í¡¥¹œì(€ô°m±½…‘¥¹œ°É•™É•Í¡¥¹t¤ì(€ÕÍ•™™•Ð  ¤€ôøì(€€€½¹ÍÐÑ¥µ•È€ôÍ•Ñ%¹Ñ•ÉÙ…°  ¤€ôøì(€€€€€¥˜€¡‰ÕÍåI•˜¹ÕÉÉ•¹Ðñð¥ÍÕ¥‘•MÕÉ™¥¹œ ¤¤É•ÑÕÉ¸ì(€€€€€Ù½¥É•™É•Í ¡ÑÉÕ”¤ì(€€€ô°€ØÀ€¨€ØÀ€¨€ÄÀÀÀ¤ì(€€€É•ÑÕÉ¸€ ¤€ôø±•…É%¹Ñ•ÉÙ…°¡Ñ¥µ•È¤ì(€ô°mÉ•™É•Í¡t¤ì((€½¹ÍÐ½Á•¹AÉ½É…´€ôÕÍ•…±±‰…¬ ¡ÁÉ½É…´èAÉ½É…´°¡…¹¹•°è¡…¹¹•°¤€ôøì(€€€¥˜€ …ÁÉ½É…´ñð€…¡…¹¹•°ñð€…¡…¹¹•°¹¥ñð€…ÁÉ½É…´¹ÍÑ…ÉÐñð9Õµ‰•È¹¥Í9…8¡…Ñ”¹Á…ÉÍ”¡ÁÉ½É…´¹ÍÑ…ÉÐ¤¤¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô(€€€Í•ÑÑ¥Ù•AÉ½É…´¡ì(€€€€€ÁÉ½É…´èì(€€€€€€€Ñ¥Ñ±”èÁÉ½É…´¹Ñ¥Ñ±”ñð€‰9¼Q¥Ñ±”ˆ°(€€€€€€€‘•ÍŒèÁÉ½É…´¹‘•ÍŒñð€ˆˆ°(€€€€€€€…Ñ•½ÉäèÁÉ½É…´¹…Ñ•½Éäñð€ˆˆ°(€€€€€€€ÍÑ…ÉÐèÁÉ½É…´¹ÍÑ…ÉÐ°(€€€€€€€ÍÑ½ÀèÁÉ½É…´¹ÍÑ½À€˜˜€…9Õµ‰•È¹¥Í9…8¡…Ñ”¹Á…ÉÍ”¡ÁÉ½É…´¹ÍÑ½À¤¤€üÁÉ½É…´¹ÍÑ½À€è¹Õ±°°(€€€€€ô°(€€€€€¡…¹¹•°°(€€€ô¤ì(€ô°mt¤ì((€½¹ÍÐ±½Í•AÉ½É…´€ôÕÍ•…±±‰…¬  ¤€ôøÍ•ÑÑ¥Ù•AÉ½É…´¡¹Õ±°¤°mt¤ì((€½¹ÍÐÙ…±Õ”èMÑ½É”€ôÕÍ•5•µ¼ (€€€€ ¤€ôø€¡ì(€€€€€¡…¹¹•±Ì°(€€€€€Ý¥¹‘½ÝMÑ…ÉÐ°(€€€€€Ý¥¹‘½Ý¹°(€€€€€±½…‘¥¹œ°(€€€€€É•™É•Í¡¥¹œ°(€€€€€•ÉÉ½È°(€€€€€É•™É•Í °(€€€€€¡…É‘I•™É•Í °(€€€€€Á…Ñ¡AÉ½É…µÍ½É¡…¹¹•±%‘Ì°(€€€€€É•Ñ…¥¹Õ¥‘•M±¥‘¥¹…¡”°(€€€€€É•±•…Í•Õ¥‘•M±¥‘¥¹…¡”°(€€€€€Í•±•Ñ•‘…Ñ”°(€€€€€Í•ÑM•±•Ñ•‘…Ñ”°(€€€€€¡…¹¹•±	å%°(€€€€€™…Ù½É¥Ñ•Ì°(€€€€€¥Í…Ù½É¥Ñ”°(€€€€€Ñ½±•…Ù½É¥Ñ”°(€€€€€É•Á±…•…Ù½É¥Ñ•Ì°(€€€€€É••¹Ð°(€€€€€É••¹Ñ%‘Ì°(€€€€€±…ÍÑ¡…¹¹•±%°(€€€€€…‘‘I••¹Ð°(€€€€€É•µ¥¹‘•ÉÌ°(€€€€€¡…ÍI•µ¥¹‘•È°(€€€€€…‘‘I•µ¥¹‘•È°(€€€€€É•µ½Ù•I•µ¥¹‘•È°(€€€€€Ñ½±•I•µ¥¹‘•È°(€€€€€…Ñ¥Ù•AÉ½É…´°(€€€€€½Á•¹AÉ½É…´°(€€€€€±½Í•AÉ½É…´°(€€€€€Á½¥¹Ñ•É5½‘”°(€€€€€Í•ÑA½¥¹Ñ•É5½‘”°(€€€€€Õ¥‘•1…å½ÕÐ°(€€€€€Í•ÑÕ¥‘•1…å½ÕÐ°(€€€€€Õ¥‘••¹Í¥Ñä°(€€€€€Í•ÑÕ¥‘••¹Í¥Ñä°(€€€€€Í…™•AÉ•Ù¥•Ý5½‘”°(€€€€€Í•ÑM…™•AÉ•Ù¥•Ý5½‘”°(€€€€€¡…¹¹•±9Õµ‰•ÉÌ°(€€€€€Í•Ñ¡…¹¹•±9Õµ‰•ÉÌ°(€€€€€¡…¹¹•±1½½Ì°(€€€€€Í•Ñ¡…¹¹•±1½½Ì°(€€€€€‘•Ù¥•1…å½ÕÑ5½‘”°(€€€€€Í•Ñ•Ù¥•1…å½ÕÑ5½‘”°(€€€€€Á±…å•É½¹ÑÉ½±ÍQ¥µ•½ÕÑ5Ì°(€€€€€Í•ÑA±…å•É½¹ÑÉ½±ÍQ¥µ•½ÕÑ5Ì°(€€€€€…ÕÑ½I•ÑÉåMÑÉ•…µÌ°(€€€€€Í•ÑÕÑ½I•ÑÉåMÑÉ•…µÌ°(€€€€€ÁÉ•™•ÉQÙ%‘=¹±ä°(€€€€€Í•ÑAÉ•™•ÉQÙ%‘=¹±ä°(€€€€€Á½Ý•ÉAÉ½™¥±”°(€€€€€Í•ÑA½Ý•ÉAÉ½™¥±”°(€€€€€±½½Í=™™]¡¥±•MÕÉ™¥¹œ°(€€€€€Í•Ñ1½½Í=™™]¡¥±•MÕÉ™¥¹œ°(€€€€€¥¹ÍÑ…¹ÑÕ¥‘”°(€€€€€Í•Ñ%¹ÍÑ…¹ÑÕ¥‘”°(€€€€€•ÁÕ¥‘•¥±Ñ•È°(€€€€€Í•ÑÁÕ¥‘•¥±Ñ•È°(€€€€€•Á5…¹Õ…±I•µ…ÁÌ°(€€€€€Í•ÑÁ5…¹Õ…±I•µ…ÁÌ°(€€€€€™…Ù½É¥Ñ•½±‘•ÉÌ°(€€€€€Í•Ñ…Ù½É¥Ñ•½±‘•ÉÌ°(€€€€€…‘‘…Ù½É¥Ñ•½±‘•È°(€€€€€Ñ½±•…Ù½É¥Ñ•½±‘•É¡…¹¹•°°(€€€€€É•¹…µ•…Ù½É¥Ñ•½±‘•ÈèÉ•¹…µ•…Ù½É¥Ñ•½±‘•É	å%°(€€€€€É•µ½Ù•…Ù½É¥Ñ•½±‘•È°(€€€€€Õ¥‘•]¥¹‘½Ý!½ÕÉÌ°(€€€€€Í•ÑÕ¥‘•]¥¹‘½Ý!½ÕÉÌ°(€€€€€±½¬ÈÑ °(€€€€€Í•Ñ±½¬ÈÑ °(€€€€€ÍÑ…ÉÑMÉ••¸°(€€€€€Í•ÑMÑ…ÉÑMÉ••¸°(€€€€€Í±••ÁQ¥µ•É5¥¹ÕÑ•Ì°(€€€€€Í•ÑM±••ÁQ¥µ•É5¥¹ÕÑ•Ì°(€€€ô¤°(€€€l(€€€€€¡…¹¹•±Ì°(€€€€€Ý¥¹‘½ÝMÑ…ÉÐ°(€€€€€Ý¥¹‘½Ý¹°(€€€€€±½…‘¥¹œ°(€€€€€É•™É•Í¡¥¹œ°(€€€€€•ÉÉ½È°(€€€€€É•™É•Í °(€€€€€¡…É‘I•™É•Í °(€€€€€Á…Ñ¡AÉ½É…µÍ½É¡…¹¹•±%‘Ì°(€€€€€É•Ñ…¥¹Õ¥‘•M±¥‘¥¹…¡”°(€€€€€É•±•…Í•Õ¥‘•M±¥‘¥¹…¡”°(€€€€€Í•±•Ñ•‘…Ñ”°(€€€€€Í•ÑM•±•Ñ•‘…Ñ”°(€€€€€¡…¹¹•±	å%°(€€€€€™…Ù½É¥Ñ•Ì°(€€€€€¥Í…Ù½É¥Ñ”°(€€€€€Ñ½±•…Ù½É¥Ñ”°(€€€€€É•Á±…•…Ù½É¥Ñ•Ì°(€€€€€É••¹Ð°(€€€€€É••¹Ñ%‘Ì°(€€€€€±…ÍÑ¡…¹¹•±%°(€€€€€…‘‘I••¹Ð°(€€€€€É•µ¥¹‘•ÉÌ°(€€€€€¡…ÍI•µ¥¹‘•È°(€€€€€…‘‘I•µ¥¹‘•È°(€€€€€É•µ½Ù•I•µ¥¹‘•È°(€€€€€Ñ½±•I•µ¥¹‘•È°(€€€€€…Ñ¥Ù•AÉ½É…´°(€€€€€½Á•¹AÉ½É…´°(€€€€€±½Í•AÉ½É…´°(€€€€€Á½¥¹Ñ•É5½‘”°(€€€€€Í•ÑA½¥¹Ñ•É5½‘”°(€€€€€Õ¥‘•1…å½ÕÐ°(€€€€€Í•ÑÕ¥‘•1…å½ÕÐ°(€€€€€Õ¥‘••¹Í¥Ñä°(€€€€€Í•ÑÕ¥‘••¹Í¥Ñä°(€€€€€Í…™•AÉ•Ù¥•Ý5½‘”°(€€€€€Í•ÑM…™•AÉ•Ù¥•Ý5½‘”°(€€€€€¡…¹¹•±9Õµ‰•ÉÌ°(€€€€€Í•Ñ¡…¹¹•±9Õµ‰•ÉÌ°(€€€€€¡…¹¹•±1½½Ì°(€€€€€Í•Ñ¡…¹¹•±1½½Ì°(€€€€€‘•Ù¥•1…å½ÕÑ5½‘”°(€€€€€Í•Ñ•Ù¥•1…å½ÕÑ5½‘”°(€€€€€Á±…å•É½¹ÑÉ½±ÍQ¥µ•½ÕÑ5Ì°(€€€€€Í•ÑA±…å•É½¹ÑÉ½±ÍQ¥µ•½ÕÑ5Ì°(€€€€€…ÕÑ½I•ÑÉåMÑÉ•…µÌ°(€€€€€Í•ÑÕÑ½I•ÑÉåMÑÉ•…µÌ°(€€€€€ÁÉ•™•ÉQÙ%‘=¹±ä°(€€€€€Í•ÑAÉ•™•ÉQÙ%‘=¹±ä°(€€€€€Á½Ý•ÉAÉ½™¥±”°(€€€€€Í•ÑA½Ý•ÉAÉ½™¥±”°(€€€€€±½½Í=™™]¡¥±•MÕÉ™¥¹œ°(€€€€€Í•Ñ1½½Í=™™]¡¥±•MÕÉ™¥¹œ°(€€€€€¥¹ÍÑ…¹ÑÕ¥‘”°(€€€€€Í•Ñ%¹ÍÑ…¹ÑÕ¥‘”°(€€€€€•ÁÕ¥‘•¥±Ñ•È°(€€€€€Í•ÑÁÕ¥‘•¥±Ñ•È°(€€€€€•Á5…¹Õ…±I•µ…ÁÌ°(€€€€€Í•ÑÁ5…¹Õ…±I•µ…ÁÌ°(€€€€€™…Ù½É¥Ñ•½±‘•ÉÌ°(€€€€€Í•Ñ…Ù½É¥Ñ•½±‘•ÉÌ°(€€€€€…‘‘…Ù½É¥Ñ•½±‘•È°(€€€€€Ñ½±•…Ù½É¥Ñ•½±‘•É¡…¹¹•°°(€€€€€É•¹…µ•…Ù½É¥Ñ•½±‘•É	å%°(€€€€€É•µ½Ù•…Ù½É¥Ñ•½±‘•È°(€€€€€Õ¥‘•]¥¹‘½Ý!½ÕÉÌ°(€€€€€Í•ÑÕ¥‘•]¥¹‘½Ý!½ÕÉÌ°(€€€€€±½¬ÈÑ °(€€€€€Í•Ñ±½¬ÈÑ °(€€€€€ÍÑ…ÉÑMÉ••¸°(€€€€€Í•ÑMÑ…ÉÑMÉ••¸°(€€€€€Í±••ÁQ¥µ•É5¥¹ÕÑ•Ì°(€€€€€Í•ÑM±••ÁQ¥µ•É5¥¹ÕÑ•Ì°(€€€t°(€€¤ì((€É•ÑÕÉ¸€ñÑà¹AÉ½Ù¥‘•ÈÙ…±Õ”õíÙ…±Õ•ôùí¡¥±‘É•¹ôð½Ñà¹AÉ½Ù¥‘•Èøì)ô(