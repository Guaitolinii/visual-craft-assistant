// sintoniza-tv-app/src/hooks/useLocalStorage.test.ts
import { describe, test, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { useLocalStorage } from './useLocalStorage';

beforeEach(() => {
  localStorage.clear();
});

describe('useLocalStorage', () => {
  test('lê o valor salvo e permite atualizar', () => {
    localStorage.setItem('sint_url', 'http://x.com/lista.m3u');
    const { result } = renderHook(() => useLocalStorage('sint_url', ''));
    expect(result.current[0]).toBe('http://x.com/lista.m3u');

    act(() => result.current[1]('http://novo.com/lista.m3u'));
    expect(result.current[0]).toBe('http://novo.com/lista.m3u');
    expect(localStorage.getItem('sint_url')).toBe('http://novo.com/lista.m3u');
  });

  test('usa o valor padrão quando não há nada salvo', () => {
    const { result } = renderHook(() => useLocalStorage('sint_epg_url', ''));
    expect(result.current[0]).toBe('');
  });
});
