// sintoniza-tv-app/src/scenes/DetailScene.tsx
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';

export function DetailScene({ title, plot, onPlay }: { title: string; plot: string; onPlay: () => void }) {
  const { ref, focused } = useFocusable({ onEnterPress: onPlay });
  return (
    <div id="tv-detail-scene">
      <h2 id="tv-detail-title">{title}</h2>
      <p id="tv-detail-plot">{plot}</p>
      <button ref={ref as any} onClick={onPlay} className={`tv-btn ${focused ? 'tv-focus' : ''}`}>
        Assistir
      </button>
    </div>
  );
}
