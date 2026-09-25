// sintoniza-tv-app/src/hooks/usePlayer.test.ts
import { describe, test, expect } from 'vitest';
import { detectStreamType } from './usePlayer';

describe('detectStreamType', () => {
  test('.m3u8 é hls', () => {
    expect(detectStreamType('http://p.com/live/u/p/1.m3u8')).toEqual({ type: 'hls', url: 'http://p.com/live/u/p/1.m3u8' });
  });

  test('caminho /live/ ou /stream sem extensão reconhecida cai para hls', () => {
    expect(detectStreamType('http://p.com/live/u/p/1')).toEqual({ type: 'hls', url: 'http://p.com/live/u/p/1' });
  });

  test('.ts sem promoção possível cai para mpegts', () => {
    expect(detectStreamType('http://p.com/outro/u/p/1.ts')).toEqual({ type: 'mpegts', url: 'http://p.com/outro/u/p/1.ts' });
  });
});
