// sintoniza-tv-app/src/components/FocusableRow.tsx
import { useFocusable, FocusContext } from '@noriginmedia/norigin-spatial-navigation';

export interface RowItem { id: string; title: string; }

function Card({ item, onSelect }: { item: RowItem; onSelect: (id: string) => void }) {
  const { ref, focused } = useFocusable({ onEnterPress: () => onSelect(item.id) });
  return (
    <div
      ref={ref as any}
      onClick={() => onSelect(item.id)}
      className={`tv-tile ${focused ? 'tv-tile--focused' : ''}`}
      role="button"
      tabIndex={0}
    >
      {item.title}
    </div>
  );
}

export function FocusableRow({ label, items, onSelect }: { label: string; items: RowItem[]; onSelect: (id: string) => void }) {
  const { ref, focusKey } = useFocusable();
  return (
    <FocusContext.Provider value={focusKey}>
      <section ref={ref as any} className="tv-row">
        <h2 className="tv-row-label">{label}</h2>
        <div className="tv-row-track">
          {items.map((item) => (
            <Card key={item.id} item={item} onSelect={onSelect} />
          ))}
        </div>
      </section>
    </FocusContext.Provider>
  );
}
