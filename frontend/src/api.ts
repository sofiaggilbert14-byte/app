const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

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

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

export const api = {
  guide: (hours = 24) => get<GuideResponse>(`/api/guide?hours=${hours}`),
  status: () => get<SourceStatus>(`/api/status/source`),
  search: (q: string) =>
    get<{ channels: Channel[]; programs: (Program & { channel_id: string; channel_name: string; channel_logo: string })[] }>(
      `/api/search?q=${encodeURIComponent(q)}`,
    ),
  refresh: async (): Promise<SourceStatus> => {
    const res = await fetch(`${BASE}/api/refresh`, { method: "POST" });
    return res.json();
  },
};
