// sintoniza-tv-app/src/ErrorBoundary.test.tsx
import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { ErrorBoundary } from './ErrorBoundary';

function Broken(): never {
  throw new Error('falha proposital de teste');
}

describe('ErrorBoundary', () => {
  test('mostra a mensagem de erro em vez de deixar a tela em branco', () => {
    // Suprime o console.error do React/Preact sobre o erro capturado - já
    // esperamos e testamos esse erro, não precisa poluir a saída do teste.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>
    );
    expect(screen.getByText('Erro ao iniciar o Sintoniza')).toBeInTheDocument();
    expect(screen.getByText(/falha proposital de teste/)).toBeInTheDocument();
  });

  test('renderiza os filhos normalmente quando não há erro', () => {
    render(
      <ErrorBoundary>
        <div>Tudo certo</div>
      </ErrorBoundary>
    );
    expect(screen.getByText('Tudo certo')).toBeInTheDocument();
  });
});
