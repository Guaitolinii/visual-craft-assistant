// sintoniza-tv-app/src/components/Sidebar.tsx
import { useFocusable, FocusContext } from '@noriginmedia/norigin-spatial-navigation';

export type SceneKey = 'home' | 'vod' | 'favs' | 'settings';

function Item({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { ref, focused } = useFocusable({ onEnterPress: onPress });
  return (
    <div
      ref={ref as any}
      onClick={onPress}
      className={`tv-sidebar-item ${active ? 'active' : ''} ${focused ? 'tv-focus' : ''}`}
    >
      {label}
    </div>
  );
}

export function Sidebar({ scene, onNavigate }: { scene: SceneKey; onNavigate: (s: SceneKey) => void }) {
  const { ref, focusKey } = useFocusable();
  return (
    <FocusContext.Provider value={focusKey}>
      <nav ref={ref as any} id="tv-sidebar">
        <Item label="Início" active={scene === 'home'} onPress={() => onNavigate('home')} />
        <Item label="Filmes e Séries" active={scene === 'vod'} onPress={() => onNavigate('vod')} />
        <Item label="Favoritos" active={scene === 'favs'} onPress={() => onNavigate('favs')} />
        <Item label="Configurações" active={scene === 'settings'} onPress={() => onNavigate('settings')} />
      </nav>
    </FocusContext.Provider>
  );
}
