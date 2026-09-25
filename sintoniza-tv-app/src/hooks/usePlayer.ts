// sintoniza-tv-app/src/hooks/usePlayer.ts
import { useRef, useCallback } from 'preact/hooks';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';

export type StreamType = 'hls' | 'mpegts';

// Decide qual motor de reprodução usar pela URL. Promoção .ts -> .m3u8
// (padrão Xtream Codes) fica de fora daqui de propósito: aquilo depende de
// uma requisição de rede (fetch HEAD), então é assíncrono e vive dentro do
// hook, não nesta função pura.
export function detectStreamType(url: string): { type: StreamType; url: string } {
  const clean = url.split('?')[0].toLowerCase();
  if (clean.endsWith('.m3u8')) return { type: 'hls', url };
  if (url.includes('/live/') || url.includes('/stream')) return { type: 'hls', url };
  return { type: 'mpegts', url };
}

export function usePlayer(videoRef: { current: HTMLVideoElement | null }) {
  const hlsRef = useRef<Hls | null>(null);
  const mpegtsRef = useRef<ReturnType<typeof mpegts.createPlayer> | null>(null);

  const release = useCallback(() => {
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    if (mpegtsRef.current) { mpegtsRef.current.destroy(); mpegtsRef.current = null; }
  }, []);

  const play = useCallback((url: string) => {
    release();
    const video = videoRef.current;
    if (!video) return;
    const { type, url: finalUrl } = detectStreamType(url);
    if (type === 'hls' && Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(finalUrl);
      hls.attachMedia(video);
      hlsRef.current = hls;
    } else {
      const player = mpegts.createPlayer({ type: 'mse', isLive: true, url: finalUrl });
      player.attachMediaElement(video);
      player.load();
      player.play();
      mpegtsRef.current = player;
    }
  }, [videoRef, release]);

  return { play, release };
}
