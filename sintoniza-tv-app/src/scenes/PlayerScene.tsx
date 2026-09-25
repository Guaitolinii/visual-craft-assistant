// sintoniza-tv-app/src/scenes/PlayerScene.tsx
import { useEffect, useRef } from 'preact/hooks';
import { usePlayer } from '../hooks/usePlayer';
import type { Channel } from '../lib/m3u';

export function PlayerScene({ channel }: { channel: Channel }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const { play, release } = usePlayer(videoRef);

  useEffect(() => {
    play(channel.url);
    return () => release();
  }, [channel.url, play, release]);

  return (
    <div id="tv-player-scene">
      <video ref={videoRef as any} autoPlay playsInline />
      <div id="tv-channel-info">
        <div className="tv-live-badge">AO VIVO</div>
        <div id="tv-channel-name">{channel.name}</div>
        <div id="tv-channel-category">{channel.category}</div>
      </div>
    </div>
  );
}
