// sintoniza-tv-app/src/lib/epg.ts

export interface XmltvChannel { id: string; displayName: string; }
export interface Programme { channelId?: string; start: number; stop: number; title: string; }
export interface EpgIndex { [normalizedName: string]: Programme[]; }

export function decodeXmlEntities(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

export function normalizeChannelName(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    // Feeds tipo epgshare01 prefixam o nome com a região da grade regional
    // ("São Paulo/SP  SporTV HD") - a região não faz parte do nome do canal.
    .replace(/^[^/\n]+\/[A-Za-z]{2}\s+/, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\+/g, ' plus ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\b(fhd|uhd|4k|hd|sd)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// XMLTV "YYYYMMDDHHmmss ±HHMM" -> epoch ms.
export function parseXmltvDate(str: string | null | undefined): number {
  if (!str) return NaN;
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?$/.exec(String(str).trim());
  if (!m) return NaN;
  const offset = m[7] || '+0000';
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${offset[0]}${offset.slice(1, 3)}:${offset.slice(3, 5)}`;
  return Date.parse(iso);
}

const CHANNEL_ALIASES: Record<string, string> = {
  'premiere 1': 'premiere clubes',
  'premiere': 'premiere clubes',
  'sony movies': 'sony channel',
  'canal sony': 'sony channel',
};

export function resolveEpgProgrammes(index: EpgIndex, normalizedName: string): Programme[] | null {
  if (index[normalizedName]) return index[normalizedName];
  const alias = CHANNEL_ALIASES[normalizedName];
  if (alias && index[alias]) return index[alias];
  return null;
}

export function extractXmltvChannels(xmlText: string): XmltvChannel[] {
  const channels: XmltvChannel[] = [];
  const re = /<channel\s+id="([^"]*)"[^>]*>([\s\S]*?)<\/channel>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xmlText))) {
    const id = m[1];
    if (!id) continue;
    const nameMatch = /<display-name[^>]*>([^<]*)<\/display-name>/.exec(m[2]);
    if (!nameMatch) continue;
    channels.push({ id, displayName: decodeXmlEntities(nameMatch[1]) });
  }
  return channels;
}

export function extractXmltvProgrammes(xmlText: string): Programme[] {
  const programmes: Programme[] = [];
  const re = /<programme\s+([^>]*)>([\s\S]*?)<\/programme>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xmlText))) {
    const attrs = m[1];
    const body = m[2];
    const channelMatch = /channel="([^"]*)"/.exec(attrs);
    if (!channelMatch) continue;
    const startTsMatch = /start_timestamp="(\d+)"/.exec(attrs);
    const stopTsMatch = /stop_timestamp="(\d+)"/.exec(attrs);
    const startMatch = /\bstart="([^"]*)"/.exec(attrs);
    const stopMatch = /\bstop="([^"]*)"/.exec(attrs);
    const start = startTsMatch ? Number(startTsMatch[1]) * 1000 : (startMatch ? parseXmltvDate(startMatch[1]) : NaN);
    const stop = stopTsMatch ? Number(stopTsMatch[1]) * 1000 : (stopMatch ? parseXmltvDate(stopMatch[1]) : NaN);
    if (!isFinite(start) || !isFinite(stop)) continue;
    const titleMatch = /<title[^>]*>([^<]*)<\/title>/.exec(body);
    programmes.push({ channelId: channelMatch[1], start, stop, title: titleMatch ? decodeXmlEntities(titleMatch[1]) : '' });
  }
  return programmes;
}

export function mergeEpgIndexes(primary: EpgIndex, supplementary: EpgIndex): EpgIndex {
  const merged: EpgIndex = {};
  Object.keys(primary).forEach((name) => { merged[name] = primary[name]; });
  Object.keys(supplementary).forEach((name) => {
    if (!merged[name] || !merged[name].length) merged[name] = supplementary[name];
  });
  return merged;
}

export function buildNameToProgrammesIndex(
  channels: XmltvChannel[],
  programmes: Programme[],
  opts?: { nowMs?: number; keepPastMs?: number; keepFutureMs?: number }
): EpgIndex {
  const nowMs = opts?.nowMs ?? Date.now();
  const keepPastMs = opts?.keepPastMs ?? 60 * 60 * 1000;
  const keepFutureMs = opts?.keepFutureMs ?? 48 * 60 * 60 * 1000;

  const idToNames: Record<string, string[]> = {};
  channels.forEach((c) => {
    const norm = normalizeChannelName(c.displayName);
    if (!norm) return;
    if (!idToNames[c.id]) idToNames[c.id] = [];
    if (idToNames[c.id].indexOf(norm) === -1) idToNames[c.id].push(norm);
  });

  const index: EpgIndex = {};
  programmes.forEach((p) => {
    if (p.stop < nowMs - keepPastMs) return;
    if (p.start > nowMs + keepFutureMs) return;
    const names = idToNames[p.channelId!];
    if (!names) return;
    names.forEach((name) => {
      if (!index[name]) index[name] = [];
      index[name].push({ start: p.start, stop: p.stop, title: p.title });
    });
  });

  Object.keys(index).forEach((name) => {
    index[name].sort((a, b) => a.start - b.start);
  });

  return index;
}

export function getCurrentAndNextProgramme(programmes: Programme[] | undefined, nowMs: number): { current: Programme | null; next: Programme | null } {
  if (!programmes || !programmes.length) return { current: null, next: null };
  let current: Programme | null = null;
  let next: Programme | null = null;
  for (let i = 0; i < programmes.length; i++) {
    const p = programmes[i];
    if (p.start <= nowMs && nowMs < p.stop) {
      current = p;
      next = programmes[i + 1] || null;
      break;
    }
    if (p.start > nowMs) {
      next = p;
      break;
    }
  }
  return { current, next };
}

export function isEpgCacheStale(fetchedAtMs: number | null | undefined, nowMs: number, ttlMs: number): boolean {
  if (!fetchedAtMs) return true;
  return (nowMs - fetchedAtMs) >= ttlMs;
}

export function formatProgrammeTimeRange(startMs: number, stopMs: number): string {
  function fmt(ms: number) {
    const d = new Date(ms);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  return `${fmt(startMs)}–${fmt(stopMs)}`;
}
