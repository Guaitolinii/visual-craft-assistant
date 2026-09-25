// sintoniza-tv-app/src/components/FocusableRow.test.tsx
import { describe, test, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { FocusableRow } from './FocusableRow';

beforeEach(() => {
  init({ debug: false, visualDebug: false });
});

describe('FocusableRow', () => {
  test('renderiza um item focável por card, e o primeiro recebe foco ao montar', async () => {
    render(
      <FocusableRow label="Canais ao vivo" items={[{ id: '1', title: 'Canal A' }, { id: '2', title: 'Canal B' }]} onSelect={() => {}} />
    );
    expect(screen.getByText('Canais ao vivo')).toBeInTheDocument();
    expect(screen.getByText('Canal A')).toBeInTheDocument();
    expect(screen.getByText('Canal B')).toBeInTheDocument();
  });

  test('aciona onSelect ao "clicar" (equivalente a pressionar OK) num item', () => {
    let selected: string | null = null;
    render(
      <FocusableRow
        label="Canais"
        items={[{ id: '1', title: 'Canal A' }]}
        onSelect={(id) => { selected = id; }}
      />
    );
    fireEvent.click(screen.getByText('Canal A'));
    expect(selected).toBe('1');
  });
});
