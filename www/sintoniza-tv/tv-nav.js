/**
 * tv-nav.js — Motor de Navegação Espacial D-pad
 * Sintoniza IPTV — Versão Smart TV
 *
 * Implementa navegação por controle remoto usando getBoundingClientRect()
 * para encontrar o elemento focusável mais próximo na direção pressionada.
 */

(function (global) {
  'use strict';

  // ── Mapeamento de teclas do controle remoto ──────────────────────────────
  const KEY_MAP = {
    ArrowUp: 'up', Up: 'up',
    ArrowDown: 'down', Down: 'down',
    ArrowLeft: 'left', Left: 'left',
    ArrowRight: 'right', Right: 'right',
    Enter: 'ok', Return: 'ok',
    Escape: 'back', GoBack: 'back', XF86Back: 'back',
    // Tizen key codes (alguns modelos antigos usam keyCode)
    38: 'up', 40: 'down', 37: 'left', 39: 'right', 13: 'ok',
    // Botões coloridos do controle
    ColorF0Red: 'red', ColorF1Green: 'green',
    ColorF2Yellow: 'yellow', ColorF3Blue: 'blue',
    Info: 'info', XF86Info: 'info',
  };

  // ── Estado do navegador ───────────────────────────────────────────────────
  let _currentFocus = null;
  let _enabled = true;
  let _onBack = null;
  let _onKey = null;   // callback genérico para teclas especiais

  // ── Utilitários de geometria ──────────────────────────────────────────────
  function center(rect) {
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  // Distância entre centros no espaço 2D (com peso na direção principal)
  function directedDistance(fromRect, toRect, dir) {
    const from = center(fromRect);
    const to   = center(toRect);
    const dx = to.x - from.x;
    const dy = to.y - from.y;

    switch (dir) {
      case 'up':    return Math.abs(dy) * 1.0 + Math.abs(dx) * 0.5;
      case 'down':  return Math.abs(dy) * 1.0 + Math.abs(dx) * 0.5;
      case 'left':  return Math.abs(dx) * 1.0 + Math.abs(dy) * 0.5;
      case 'right': return Math.abs(dx) * 1.0 + Math.abs(dy) * 0.5;
      default:      return Infinity;
    }
  }

  // Verifica se `toRect` está na direção `dir` a partir de `fromRect`
  function isInDirection(fromRect, toRect, dir) {
    const TOLERANCE = 12; // px de tolerância para alinhamento
    switch (dir) {
      case 'up':    return toRect.bottom   <= fromRect.top    + TOLERANCE;
      case 'down':  return toRect.top      >= fromRect.bottom - TOLERANCE;
      case 'left':  return toRect.right    <= fromRect.left   + TOLERANCE;
      case 'right': return toRect.left     >= fromRect.right  - TOLERANCE;
      default:      return false;
    }
  }

  // ── Seleção de elementos focusáveis ─────────────────────────────────────
  function getFocusables() {
    // Todos os elementos com [data-focusable] que estão visíveis e não desabilitados
    return Array.from(document.querySelectorAll('[data-focusable]')).filter(el => {
      if (el.disabled) return false;
      if (el.closest('[hidden]')) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  }

  // ── Aplicar/remover foco visual ──────────────────────────────────────────
  function applyFocus(el) {
    if (_currentFocus && _currentFocus !== el) {
      _currentFocus.classList.remove('tv-focus');
      _currentFocus.setAttribute('aria-selected', 'false');
    }
    _currentFocus = el;
    if (!el) return;

    el.classList.add('tv-focus');
    el.setAttribute('aria-selected', 'true');
    el.focus({ preventScroll: true });

    // Scroll suave para manter o elemento visível
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }

  // ── Navegação principal ───────────────────────────────────────────────────
  function navigate(dir) {
    const focusables = getFocusables();
    if (focusables.length === 0) return;

    // Sem foco atual: foca o primeiro elemento
    if (!_currentFocus || !document.contains(_currentFocus)) {
      applyFocus(focusables[0]);
      return;
    }

    const currentRect = _currentFocus.getBoundingClientRect();
    const candidates = focusables
      .filter(el => el !== _currentFocus)
      .filter(el => isInDirection(currentRect, el.getBoundingClientRect(), dir));

    if (candidates.length === 0) return; // Borda — sem movimento

    // Encontra o mais próximo na direção
    const best = candidates.reduce((prev, el) => {
      const d1 = directedDistance(currentRect, prev.getBoundingClientRect(), dir);
      const d2 = directedDistance(currentRect, el.getBoundingClientRect(), dir);
      return d2 < d1 ? el : prev;
    });

    applyFocus(best);
  }

  // ── Ações de teclado ─────────────────────────────────────────────────────
  function handleKeydown(e) {
    if (!_enabled) return;

    // Ignora se o foco está em um input de texto
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
      if (e.key !== 'Escape' && e.key !== 'GoBack') return;
    }

    const action = KEY_MAP[e.key] || KEY_MAP[e.keyCode];
    if (!action) return;

    e.preventDefault();
    e.stopPropagation();

    switch (action) {
      case 'up':
      case 'down':
      case 'left':
      case 'right':
        navigate(action);
        break;

      case 'ok':
        if (_currentFocus) {
          _currentFocus.click();
        } else {
          const focusables = getFocusables();
          if (focusables.length > 0) applyFocus(focusables[0]);
        }
        break;

      case 'back':
        if (_onBack) _onBack();
        break;

      default:
        if (_onKey) _onKey(action, e);
    }
  }

  // ── API pública ──────────────────────────────────────────────────────────
  const TVNav = {
    /**
     * Inicializa o motor de navegação.
     * @param {object} opts
     * @param {function} opts.onBack   — callback para o botão Voltar
     * @param {function} opts.onKey    — callback para teclas especiais (info, red, green…)
     */
    init(opts = {}) {
      _onBack = opts.onBack || null;
      _onKey  = opts.onKey  || null;
      document.addEventListener('keydown', handleKeydown, true);
      // Foca o primeiro elemento após um tick para garantir DOM pronto
      setTimeout(() => {
        const els = getFocusables();
        if (els.length > 0) applyFocus(els[0]);
      }, 100);
    },

    /** Foca um elemento específico pelo seletor ou elemento */
    focusEl(elOrSelector) {
      const el = typeof elOrSelector === 'string'
        ? document.querySelector(elOrSelector)
        : elOrSelector;
      if (el) applyFocus(el);
    },

    /** Foca o primeiro elemento focusável */
    focusFirst() {
      const els = getFocusables();
      if (els.length > 0) applyFocus(els[0]);
    },

    /** Retorna o elemento atualmente focado */
    getCurrent() {
      return _currentFocus;
    },

    /** Ativa/desativa a navegação (útil quando modal está aberto) */
    setEnabled(val) {
      _enabled = val;
    },

    /** Remove o foco visual sem destruir o estado */
    blur() {
      if (_currentFocus) {
        _currentFocus.classList.remove('tv-focus');
      }
      _currentFocus = null;
    },

    /** Destrói o motor (remove listeners) */
    destroy() {
      document.removeEventListener('keydown', handleKeydown, true);
      _currentFocus = null;
    },
  };

  global.TVNav = TVNav;
})(window);
