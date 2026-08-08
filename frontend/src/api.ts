// Shared data types. Data is fetched & parsed on-device in `@/src/source`.

export type Program = {
  title: string;
  desc: string;
  category: string;
  start: string;
  stop: string | null;
};

export type Channel = {
  id: string;
  tvg_id: string;
  name: string;
  logo: string;
  group: string;
  url: string;
  stream_type: string;
  programs?: Program[];
};

export type GuideResponse = {
  start: string;
  end: string;
  now: string;
  channels: Channel[];
  /** Normalized programme map keyed by playlist channel id (preferred over channel.programs). */
  programsByChannelId?: Record<string, Program[]>;
  /** Native XMLTV epoch so programme rows never survive a fresh guide swap. */
  guideEpoch?: number;
};

export type SourceStatus = {
  m3u_url: string;
  epg_url: string;
  channel_count: number;
  channels_with_epg: number;
  last_refresh: string | null;
  refreshing: boolean;
  error: string | null;
};
