// sintoniza-tv-app/src/scenes/SettingsScene.tsx
import { useState } from 'preact/hooks';
import { useFocusable, FocusContext } from '@noriginmedia/norigin-spatial-navigation';
import { OnScreenKeyboard } from '../components/OnScreenKeyboard';
import { useLocalStorage } from '../hooks/useLocalStorage';

type FieldKey = 'm3u' | 'epg' | 'vod';

function Field({ testId, label, value, onOpenKeyboard }: { testId: string; label: string; value: string; onOpenKeyboard: () => void }) {
  const { ref, focused } = useFocusable({ onEnterPress: onOpenKeyboard });
  return (
    <div className="tv-settings-field">
      <label>{label}</label>
      <div
        ref={ref as any}
        data-testid={testId}
        onClick={onOpenKeyboard}
        className={`tv-input ${focused ? 'tv-focus' : ''}`}
      >
        {value || 'Pressione OK para digitar'}
      </div>
    </div>
  );
}

export function SettingsScene({ onSave }: { onSave: (values: { m3u: string; epg: string; vod: string }) => void }) {
  const [m3u, setM3u] = useLocalStorage('sint_url', '');
  const [epg, setEpg] = useLocalStorage('sint_epg_url', '');
  const [vod, setVod] = useLocalStorage('sint_vod_url', '');
  const [editing, setEditing] = useState<FieldKey | null>(null);
  const { ref, focusKey } = useFocusable();

  const values: Record<FieldKey, [string, (v: string) => void]> = {
    m3u: [m3u, setM3u],
    epg: [epg, setEpg],
    vod: [vod, setVod],
  };

  const { ref: saveRef, focused: saveFocused } = useFocusable({
    onEnterPress: () => onSave({ m3u, epg, vod }),
  });

  if (editing) {
    const [value, setValue] = values[editing];
    return (
      <OnScreenKeyboard
        label={editing === 'm3u' ? 'URL da lista M3U' : editing === 'epg' ? 'EPG' : 'Filmes e Séries'}
        value={value}
        onChange={setValue}
        onDone={() => setEditing(null)}
      />
    );
  }

  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref as any} id="tv-settings-scene">
        <h2>Sintoniza — Configurações</h2>
        <p>Informe suas URLs para começar a assistir. Pressione OK sobre o campo para abrir o teclado.</p>
        <Field testId="field-m3u" label="URL da lista M3U" value={m3u} onOpenKeyboard={() => setEditing('m3u')} />
        <Field testId="field-epg" label="EPG — guia de programação (opcional)" value={epg} onOpenKeyboard={() => setEditing('epg')} />
        <Field testId="field-vod" label="Filmes e Séries — catálogo (opcional)" value={vod} onOpenKeyboard={() => setEditing('vod')} />
        <button
          ref={saveRef as any}
          className={`tv-btn ${saveFocused ? 'tv-focus' : ''}`}
          onClick={() => onSave({ m3u, epg, vod })}
        >
          Salvar e Carregar
        </button>
      </div>
    </FocusContext.Provider>
  );
}
