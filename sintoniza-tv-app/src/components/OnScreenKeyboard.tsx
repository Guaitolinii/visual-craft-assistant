// sintoniza-tv-app/src/components/OnScreenKeyboard.tsx
import { useState } from 'preact/hooks';
import { useFocusable, FocusContext } from '@noriginmedia/norigin-spatial-navigation';

const LAYOUT_LOWER = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
  [':', '/', '.', '?', '=', '&', '-', '_', '@', '~'],
];
const LAYOUT_UPPER = LAYOUT_LOWER.map((row, i) => (i < 4 ? row.map((c) => c.toUpperCase()) : row));

function Key({ label, onPress, wide }: { label: string; onPress: () => void; wide?: boolean }) {
  const { ref, focused } = useFocusable({ onEnterPress: onPress });
  return (
    <button
      ref={ref as any}
      onClick={onPress}
      className={`tv-osk-key ${wide ? 'wide' : ''} ${focused ? 'tv-focus' : ''}`}
    >
      {label}
    </button>
  );
}

export function OnScreenKeyboard({
  value,
  onChange,
  onDone,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  onDone: () => void;
  label: string;
}) {
  const [upper, setUpper] = useState(false);
  const { ref, focusKey } = useFocusable();
  const layout = upper ? LAYOUT_UPPER : LAYOUT_LOWER;

  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref as any} className="tv-osk" aria-label="Teclado virtual">
        <div className="tv-osk-label">{label}</div>
        <div className="tv-osk-display">{value}</div>
        <div className="tv-osk-grid">
          {layout.map((row, i) => (
            <div className="tv-osk-row" key={i}>
              {row.map((ch) => (
                <Key key={ch} label={ch} onPress={() => onChange(value + ch)} />
              ))}
            </div>
          ))}
          <div className="tv-osk-row">
            <Key label={upper ? '⇩ Minúscula' : '⇧ Maiúscula'} onPress={() => setUpper(!upper)} wide />
            <Key label="Espaço" onPress={() => onChange(value + ' ')} wide />
            <Key label="← Apagar" onPress={() => onChange(value.slice(0, -1))} wide />
            <Key label="Limpar" onPress={() => onChange('')} wide />
            <Key label="Concluir" onPress={onDone} wide />
          </div>
        </div>
      </div>
    </FocusContext.Provider>
  );
}
