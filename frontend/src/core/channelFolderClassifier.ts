import type { Channel } from "@/src/api";

export const DEFAULT_CHANNEL_FOLDERS = [
  "Sports",
  "News",
  "Movies",
  "Kids",
  "Music",
  "Entertainment",
  "Local",
  "Documentary",
  "Lifestyle",
  "International",
  "Religious",
  "Shopping",
  "Miscellaneous",
] as const;

export type DefaultChannelFolder = (typeof DEFAULT_CHANNEL_FOLDERS)[number];

const RULES: Array<{ folder: DefaultChannelFolder; re: RegExp }> = [
  { folder: "Sports", re: /\b(sport|sports|nfl|nba|mlb|nhl|ufc|mma|boxing|espn|bein|golf|tennis|f1|formula|racing|wwe|cricket|soccer|football)\b/i },
  { folder: "News", re: /\b(news|weather|cnn|fox\s*news|msnbc|bbc\s*news|cnbc|bloomberg|sky\s*news|newsmax|oann|local\s*news)\b/i },
  { folder: "Kids", re: /\b(kid|kids|children|family|cartoon|nick|nickelodeon|disney|boomerang|pbs\s*kids|cartoon\s*network)\b/i },
  { folder: "Music", re: /\b(music|mtv|vh1|radio|hits|vevo|country\s*music|rap|hip\s*hop|rock|jazz)\b/i },
  { folder: "Movies", re: /\b(movie|movies|cinema|film|films|hbo|showtime|starz|cinemax|epix|mgm\+|movieplex)\b/i },
  { folder: "Documentary", re: /\b(documentary|discovery|history|nat\s*geo|national\s*geographic|science|smithsonian|animal\s*planet)\b/i },
  { folder: "Lifestyle", re: /\b(lifestyle|food|cooking|hgtv|travel|diy|home|garden|tlc|health|fitness)\b/i },
  { folder: "Religious", re: /\b(church|religion|religious|christian|gospel|catholic|ewtn|tbn|faith|ministry|islam|muslim|jewish)\b/i },
  { folder: "Shopping", re: /\b(qvc|hsn|shopping|shop\s*hq|shoplc)\b/i },
  { folder: "Local", re: /\b(local|abc\s*\d|cbs\s*\d|nbc\s*\d|fox\s*\d|cw\s*\d|pbs\s*\d)\b/i },
  { folder: "International", re: /\b(international|latino|spanish|espanol|mexico|mexican|canada|canadian|uk|british|india|indian|arabic|africa|african|asia|asian|france|french|germany|german|italy|italian|portugal|portuguese|brazil|brazilian)\b/i },
  { folder: "Entertainment", re: /\b(entertainment|general|network|comedy|drama|reality|amc|fx|fxx|tnt|tbs|usa\s*network|paramount|bravo|e!|a&e|syfy|freeform|ion|me\s*tv|antenna\s*tv)\b/i },
];

function normalize(value: unknown): string {
  return String(value || "")
    .replace(/[|_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Returns exactly one CharmIPTV folder. Provider group-title is only a hint;
 * it never becomes a visible tab unless the user explicitly enables provider
 * groups. One primary folder prevents the same channel from appearing in five
 * near-duplicate automatic tabs.
 */
export function classifyChannelFolder(channel: Channel): DefaultChannelFolder {
  const providerGroup = normalize(channel.group);
  const channelName = normalize(channel.name);
  const tvgId = normalize(channel.tvg_id);
  const haystack = `${providerGroup} ${channelName} ${tvgId}`;
  for (const rule of RULES) {
    if (rule.re.test(haystack)) return rule.folder;
  }
  return "Miscellaneous";
}
