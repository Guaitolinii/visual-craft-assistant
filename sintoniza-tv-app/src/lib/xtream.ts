// sintoniza-tv-app/src/lib/xtream.ts
export interface XtreamCreds { base: string; username: string; password: string; }

export function parseXtreamCredentials(m3uUrl: string): XtreamCreds | null {
  let url: URL;
  try {
    url = new URL(m3uUrl);
  } catch {
    return null;
  }
  const username = url.searchParams.get('username');
  const password = url.searchParams.get('password');
  if (!username || !password) return null;
  return { base: `${url.protocol}//${url.host}`, username, password };
}

export function xtreamApiUrl(creds: XtreamCreds, action: string, extraParams?: Record<string, string>): string {
  const params = new URLSearchParams({
    username: creds.username,
    password: creds.password,
    action,
    ...(extraParams || {}),
  });
  return `${creds.base}/player_api.php?${params.toString()}`;
}

export function buildVodStreamUrl(creds: XtreamCreds, streamId: number, containerExtension?: string): string {
  const ext = containerExtension || 'mp4';
  return `${creds.base}/movie/${creds.username}/${creds.password}/${streamId}.${ext}`;
}

export function buildSeriesEpisodeUrl(creds: XtreamCreds, episodeId: number, containerExtension?: string): string {
  const ext = containerExtension || 'mp4';
  return `${creds.base}/series/${creds.username}/${creds.password}/${episodeId}.${ext}`;
}
