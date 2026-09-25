// sintoniza-tv-app/src/components/OnScreenKeyboard.test.tsx
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { OnScreenKeyboard } from './OnScreenKeyboard';

beforeEach(() => {
  init({ debug: false, visualDebug: false });
});

describe('OnScreenKeyboard', () => {
  test('digita letras clicando nas teclas e chama onChange com o valor acumulado', () => {
    const onChange = vi.fn();
    render(<OnScreenKeyboard value="" onChange={onChange} onDone={() => {}} label="URL da lista" />);
    fireEvent.click(screen.getByText('h'));
    expect(onChange).toHaveBeenCalledWith('h');
  });

  test('Apagar remove o último caractere', () => {
    const onChange = vi.fn();
    render(<OnScreenKeyboard value="abc" onChange={onChange} onDone={() => {}} label="URL" />);
    fireEvent.click(screen.getByText('← Apagar'));
    expect(onChange).toHaveBeenCalledWith('ab');
  });

  test('Limpar zera o campo', () => {
    const onChange = vi.fn();
    render(<OnScreenKeyboard value="abc" onChange={onChange} onDone={() => {}} label="URL" />);
    fireEvent.click(screen.getByText('Limpar'));
    expect(onChange).toHaveBeenCalledWith('');
  });

  test('Concluir chama onDone', () => {
    const onDone = vi.fn();
    render(<OnScreenKeyboard value="abc" onChange={() => {}} onDone={onDone} label="URL" />);
    fireEvent.click(screen.getByText('Concluir'));
    expect(onDone).toHaveBeenCalled();
  });
});
