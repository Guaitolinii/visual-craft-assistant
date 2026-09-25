import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/preact';

// Sem isso, cada render() num teste ficava no DOM até o fim do arquivo -
// o 2º/3º teste do mesmo describe() encontrava elementos duplicados
// (do teste anterior + o novo), e getByText/getByTestId falhava com
// "multiple elements found".
afterEach(() => {
  cleanup();
});

const localStorageMock = (function() {
  let store: Record<string, string> = {};
  return {
    getItem: function(key: string) { return store[key] || null; },
    setItem: function(key: string, value: string) { store[key] = value.toString(); },
    clear: function() { store = {}; },
    removeItem: function(key: string) { delete store[key]; }
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });
