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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(`${BASE}${path}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  guide: (hours = 24, start?: string) =>
    get<GuideResponse>(`/api/guide?hours=${hours}${start ? `&start=${encodeURIComponent(start)}` : ""}`),
  status: () => get<SourceStatus>(`/api/status/source`),
  settings: () => get<{ m3u_url: string; epg_url: string }>(`/api/settings`),
  search: (q: string) =>
    get<{ channels: Channel[]; programs: (Program & { channel_id: string; channel_name: string; channel_logo: string })[] }>(
      `/api/search?q=${encodeURIComponent(q)}`,
    ),
  refresh: async (): Promise<SourceStatus> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const res = await fetch(`${BASE}/api/refresh`, { method: "POST", signal: controller.signal });
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  },
  adminLogin: async (username: string, password: string): Promise<string> => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw new Error("Incorrect username or password");
    const json = await res.json();
    return json.access_token as string;
  },
  verifyAdmin: async (token: string): Promise<boolean> => {
    const res = await fetch(`${BASE}/api/auth/verify`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok;
  },
  updateSettings: async (token: string, m3u_url: string, epg_url: string): Promise<SourceStatus> => {
    const res = await fetch(`${BASE}/api/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ m3u_url, epg_url }),
    });
    if (res.status === 401) throw new Error("UNAUTHORIZED");
    if (!res.ok) throw new Error("Update failed");
    return res.json();
  },
};
