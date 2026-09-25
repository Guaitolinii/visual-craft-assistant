// sintoniza-tv-app/src/lib/m3u.ts
export interface Channel {
  id: number;
  name: string;
  category: string;
  logo: string | null;
  url: string;
}

export interface VodItem {
  [key: string]: unknown;
  name?: string;
  title?: string;
  plot?: string;
  category_name?: string;
  stream_icon?: string;
  cover?: string;
}

// Textos vindos do provedor (lista M3U / API Xtream) entram na interface;
// um nome como <img onerror=...> rodaria código com acesso ao bridge nativo
// do app. Limpamos na entrada: rótulo sem < > " e imagem só http(s) sem
// aspas/espaços (ver docs/superpowers/plans/2026-09-23-v8-downloads-pip-e-correcoes.md,
// Task 1, mesma correção portada para cá).
export function sanitizeLabel(text: unknown): string {
  return String(text == null ? '' : text).replace(/[<>"]/g, '').trim();
}

export function sanitizeImageUrl(url: unknown): string {
  const u = String(url || '').trim();
  return /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : '';
}

export function sanitizeVodItem<T extends VodItem>(item: T): T {
  if (!item || typeof item !== 'object') return item;
  const out = { ...item };
  (['name', 'title', 'plot', 'category_name'] as const).forEach((k) => {
    if (out[k] != null) out[k] = sanitizeLabel(out[k]) as T[typeof k];
  });
  (['stream_icon', 'cover'] as const).forEach((k) => {
    if (out[k] != null) out[k] = sanitizeImageUrl(out[k]) as T[typeof k];
  });
  return out;
}

let _idCounter = 1;

export function parseM3U(text: string): Channel[] {
  const channels: Channel[] = [];
  const lines = text.split(/\r?\n/);
  let extinf: { name: string; logo: string | null; category: string } | null = null;

  for (const line of lines) {
    if (line.startsWith('#EXTINF')) {
      const logoMatch = /tvg-logo="([^"]*)"/.exec(line);
      const groupMatch = /group-title="([^"]*)"/.exec(line);
      const tvgName = /tvg-name="([^"]*)"/.exec(line);
      const displayName = line.split(',').slice(1).join(',').trim();
      extinf = {
        name: sanitizeLabel(displayName || (tvgName ? tvgName[1] : 'Canal')) || 'Canal',
        logo: logoMatch ? (sanitizeImageUrl(logoMatch[1]) || null) : null,
        category: groupMatch ? (sanitizeLabel(groupMatch[1]) || 'Geral') : 'Geral',
      };
    } else if (line.trim() && !line.startsWith('#') && extinf) {
      channels.push({ id: _idCounter++, ...extinf, url: line.trim() });
      extinf = null;
    }
  }
  return channels;
}
