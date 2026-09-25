// sintoniza-tv-app/src/App.tsx
import { useState, useEffect } from 'preact/hooks';
import { Sidebar, type SceneKey } from './components/Sidebar';
import { HomeScene } from './scenes/HomeScene';
import { SettingsScene } from './scenes/SettingsScene';
import { PlayerScene } from './scenes/PlayerScene';
import { parseM3U, type Channel } from './lib/m3u';
import { useLocalStorage } from './hooks/useLocalStorage';

export function App() {
  const [scene, setScene] = useState<SceneKey>('home');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [playing, setPlaying] = useState<Channel | null>(null);
  // 'sint_fav' é a MESMA chave usada por sintoniza-link.html e pelo
  // sintoniza-tv/sintoniza-tv.html vanilla - guarda os nomes dos canais
  // favoritos, para o corte da Tarefa 10 não perder os favoritos que o
  // usuário já tinha salvo antes da migração.
  const [favNamesJson] = useLocalStorage('sint_fav', '[]');
  const [savedUrl] = useLocalStorage('sint_url', '');

  useEffect(() => {
    if (!savedUrl) return;
    fetch(savedUrl, { cache: 'no-store' })
      .then((r) => r.text())
      .then((text) => setChannels(parseM3U(text)))
      .catch(() => setChannels([]));
  }, [savedUrl]);

  if (playing) {
    return <PlayerScene channel={playing} />;
  }

  return (
    <div id="tv-app">
      <Sidebar scene={scene} onNavigate={setScene} />
      {scene === 'settings' ? (
        <SettingsScene
          onSave={({ m3u, epg, vod }) => {
            localStorage.setItem('sint_url', m3u);
            if (epg) localStorage.setItem('sint_epg_url', epg);
            if (vod) localStorage.setItem('sint_vod_url', vod);
            setScene('home');
            if (m3u) {
              fetch(m3u, { cache: 'no-store' })
                .then((r) => r.text())
                .then((text) => setChannels(parseM3U(text)))
                .catch(() => setChannels([]));
            }
          }}
        />
      ) : (
        <HomeScene
          channels={channels}
          favoriteNames={JSON.parse(favNamesJson || '[]')}
          onSelectChannel={(id) => {
            const ch = channels.find((c) => String(c.id) === id);
            if (ch) setPlaying(ch);
          }}
        />
      )}
    </div>
  );
}
