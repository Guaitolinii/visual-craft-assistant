// sintoniza-tv-app/src/scenes/HomeScene.tsx
import { FocusableRow } from '../components/FocusableRow';
import type { Channel } from '../lib/m3u';

export function HomeScene({
  channels,
  favoriteNames,
  onSelectChannel,
}: {
  channels: Channel[];
  // Favoritos são guardados pelo NOME do canal, não pelo id (mesma
  // convenção de sint_fav já usada em sintoniza-link.html e no vanilla
  // sintoniza-tv/sintoniza-tv.html - o id muda se a lista for recarregada
  // em ordem diferente, o nome não).
  favoriteNames: string[];
  onSelectChannel: (id: string) => void;
}) {
  const favorites = channels.filter((c) => favoriteNames.includes(c.name));

  return (
    <div id="tv-home">
      {favorites.length > 0 && (
        <FocusableRow
          label="Favoritos"
          items={favorites.map((c) => ({ id: String(c.id), title: c.name }))}
          onSelect={onSelectChannel}
        />
      )}
      <FocusableRow
        label="Canais ao vivo"
        items={
          channels.length
            ? channels.slice(0, 30).map((c) => ({ id: String(c.id), title: c.name }))
            : [{ id: 'empty', title: 'Nenhum canal carregado — abra Configurações' }]
        }
        onSelect={onSelectChannel}
      />
    </div>
  );
}
