// sintoniza-tv-app/src/lib/xtream.test.ts
import { describe, test, expect } from 'vitest';
import { parseXtreamCredentials, xtreamApiUrl, buildVodStreamUrl, buildSeriesEpisodeUrl } from './xtream';

describe('parseXtreamCredentials', () => {
  test('extrai base/username/password de uma URL M3U Xtream válida', () => {
    const creds = parseXtreamCredentials('http://provedor.com:8080/get.php?username=user1&password=pass1&type=m3u_plus');
    expect(creds).toEqual({ base: 'http://provedor.com:8080', username: 'user1', password: 'pass1' });
  });

  test('retorna null quando username/password faltam', () => {
    expect(parseXtreamCredentials('http://provedor.com/get.php?type=m3u_plus')).toBeNull();
  });

  test('retorna null para URL não parseável', () => {
    expect(parseXtreamCredentials('não é uma url')).toBeNull();
  });
});

test('xtreamApiUrl monta a URL do player_api.php com username/password/action', () => {
  const creds = { base: 'http://p.com', username: 'u', password: 'p' };
  const url = xtreamApiUrl(creds, 'get_live_categories');
  expect(url).toBe('http://p.com/player_api.php?username=u&password=p&action=get_live_categories');
});

test('xtreamApiUrl acrescenta parâmetros extras', () => {
  const creds = { base: 'http://p.com', username: 'u', password: 'p' };
  const url = xtreamApiUrl(creds, 'get_vod_info', { vod_id: '42' });
  expect(url).toContain('vod_id=42');
});

test('buildVodStreamUrl monta a URL direta de movie/', () => {
  const creds = { base: 'http://p.com', username: 'u', password: 'p' };
  expect(buildVodStreamUrl(creds, 42, 'mkv')).toBe('http://p.com/movie/u/p/42.mkv');
});

test('buildVodStreamUrl usa mp4 como extensão padrão', () => {
  const creds = { base: 'http://p.com', username: 'u', password: 'p' };
  expect(buildVodStreamUrl(creds, 42)).toBe('http://p.com/movie/u/p/42.mp4');
});

test('buildSeriesEpisodeUrl monta a URL direta de series/', () => {
  const creds = { base: 'http://p.com', username: 'u', password: 'p' };
  expect(buildSeriesEpisodeUrl(creds, 501, 'mkv')).toBe('http://p.com/series/u/p/501.mkv');
});
