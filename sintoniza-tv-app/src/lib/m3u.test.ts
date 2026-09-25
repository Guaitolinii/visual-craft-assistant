// sintoniza-tv-app/src/lib/m3u.test.ts
import { describe, test, expect } from 'vitest';
import { sanitizeLabel, sanitizeImageUrl, sanitizeVodItem, parseM3U } from './m3u';

describe('sanitizeLabel', () => {
  test('tira caracteres que abrem HTML', () => {
    expect(sanitizeLabel('<img src=x onerror="alert(1)">ESPN')).toBe('img src=x onerror=alert(1)ESPN');
    expect(sanitizeLabel('A&E Brasil')).toBe('A&E Brasil');
    expect(sanitizeLabel(null)).toBe('');
  });
});

describe('sanitizeImageUrl', () => {
  test('só aceita http(s) sem aspas/espaços', () => {
    expect(sanitizeImageUrl('https://cdn.x/logo.png')).toBe('https://cdn.x/logo.png');
    expect(sanitizeImageUrl('x" onerror="alert(1)')).toBe('');
    expect(sanitizeImageUrl('javascript:alert(1)')).toBe('');
    expect(sanitizeImageUrl('')).toBe('');
  });
});

describe('sanitizeVodItem', () => {
  test('limpa nome, capa e plot do item da API', () => {
    const out = sanitizeVodItem({ stream_id: 1, name: '<b>Duna</b>', stream_icon: 'javascript:x', cover: 'https://c/d.jpg', plot: '<script>x</script>ok' });
    expect(out.name).toBe('bDuna/b');
    expect(out.stream_icon).toBe('');
    expect(out.cover).toBe('https://c/d.jpg');
    expect(out.plot).toBe('scriptx/scriptok');
    expect(out.stream_id).toBe(1);
  });
});

describe('parseM3U', () => {
  test('limpa nome, categoria e logo maliciosos', () => {
    const m3u = '#EXTM3U\n#EXTINF:-1 tvg-logo="x&quot; onerror=&quot;alert(1)" group-title="<b>Esportes</b>",<img src=x onerror=alert(1)>ESPN\nhttp://srv/live/u/p/1.ts\n';
    const [ch] = parseM3U(m3u);
    expect(ch.name).toBe('img src=x onerror=alert(1)ESPN');
    expect(ch.category).toBe('bEsportes/b');
    expect(ch.logo).toBeNull();
  });
});
