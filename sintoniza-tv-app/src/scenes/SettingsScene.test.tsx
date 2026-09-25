// sintoniza-tv-app/src/scenes/SettingsScene.test.tsx
import { describe, test, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { SettingsScene } from './SettingsScene';

beforeEach(() => {
  init({ debug: false, visualDebug: false });
  localStorage.clear();
});

describe('SettingsScene', () => {
  test('pré-preenche os campos com o que já está salvo', () => {
    localStorage.setItem('sint_url', 'http://ja-salvo.com/lista.m3u');
    render(<SettingsScene onSave={() => {}} />);
    expect(screen.getByText('http://ja-salvo.com/lista.m3u')).toBeInTheDocument();
  });

  test('abrir o teclado no campo M3U e digitar atualiza o valor exibido', () => {
    render(<SettingsScene onSave={() => {}} />);
    fireEvent.click(screen.getByTestId('field-m3u'));
    fireEvent.click(screen.getByText('h'));
    fireEvent.click(screen.getByText('t'));
    // O teclado SUBSTITUI a tela de Configurações enquanto está aberto
    // (não fica por cima) - "field-m3u" só volta ao DOM depois de
    // "Concluir", que é quando dá pra conferir o valor digitado nele.
    fireEvent.click(screen.getByText('Concluir'));
    expect(screen.getByTestId('field-m3u')).toHaveTextContent('ht');
  });

  test('Salvar chama onSave com os três valores', () => {
    let saved: { m3u: string; epg: string; vod: string } | null = null;
    render(<SettingsScene onSave={(v) => { saved = v; }} />);
    fireEvent.click(screen.getByTestId('field-m3u'));
    fireEvent.click(screen.getByText('h'));
    fireEvent.click(screen.getByText('Concluir'));
    fireEvent.click(screen.getByText('Salvar e Carregar'));
    expect(saved).toEqual({ m3u: 'h', epg: '', vod: '' });
  });
});
