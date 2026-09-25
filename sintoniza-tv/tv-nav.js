/**
 * tv-nav.js — Motor de Navegação Espacial D-pad (único)
 * Sintoniza IPTV — Versão Smart TV
 *
 * Implementa navegação por controle remoto usando getBoundingClientRect()
 * para encontrar o elemento focusável mais próximo na direção pressionada.
 *
 * Regras de design (doc de reconstrução, seção 3.1):
 *  1. Sempre usa document.activeElement como fonte de verdade (nunca _currentFocus sombra).
 *  2. Nunca bloqueia direções inteiras só porque o foco está num <input>.
 *  3. Carregado via <script src="tv-nav.js"> ANTES do script principal.
 */

(function (global) {
  'use strict';

  // ── Mapeamento de teclas do controle remoto ──────────────────────────────
  var KEY_MAP = {
    ArrowUp: 'up', Up: 'up',
    ArrowDown: 'down', Down: 'down',
    ArrowLeft: 'left', Left: 'left',
    ArrowRight: 'right', Right: 'right',
    Enter: 'ok', Return: 'ok',
    Escape: 'back', GoBack: 'back', XF86Back: 'back',
    MediaPlayPause: 'playpause', MediaPlay: 'playpause', MediaPause: 'playpause',
    ColorF0Red: 'red', ColorF1Green: 'green',
    ColorF2Yellow: 'yellow', ColorF3Blue: 'blue',
    Info: 'info', XF86Info: 'info'
  };
  // Tizen/webOS key codes: o botão Voltar do controle da LG chega com
  // event.key === "Unidentified" (documentado pela própria LG - ver
  // webostv.developer.lge.com/develop/guides/back-button), então só dá
  // para reconhecê-lo pelo keyCode 461. Sem isso, "Voltar" não faz nada
  // nessa TV - e como abrir o menu lateral depende só do Voltar (não há
  // botão de menu visível na tela), o app inteiro fica sem acesso a
  // Configurações. 10009 é o keyCode equivalente do controle da Samsung
  // Tizen (mantido para não perder compatibilidade com o outro lado).
  var KEY_CODE_MAP = {
    38: 'up', 40: 'down', 37: 'left', 39: 'right', 13: 'ok',
    461: 'back', 10009: 'back', 10252: 'playpause',
    403: 'red', 404: 'green', 405: 'yellow', 406: 'blue', 457: 'info'
  };

  var _enabled = true;
  var _onBack = null;
  var _onKey = null;
  // Quando o teclado on-screen está aberto, ele consome certas teclas
  var _osk = null; // { isOpen, handleKey } — injetado pelo componente de teclado

  // ── Utilitários de geometria ──────────────────────────────────────────────
  function center(rect) {
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function directedDistance(fromRect, toRect, dir) {
    var from = center(fromRect);
    var to   = center(toRect);
    var dx = to.x - from.x;
    var dy = to.y - from.y;

    switch (dir) {
      case 'up':    return Math.abs(dy) * 1.0 + Math.abs(dx) * 0.5;
      case 'down':  return Math.abs(dy) * 1.0 + Math.abs(dx) * 0.5;
      case 'left':  return Math.abs(dx) * 1.0 + Math.abs(dy) * 0.5;
      case 'right': return Math.abs(dx) * 1.0 + Math.abs(dy) * 0.5;
      default:      return Infinity;
    }
  }

  function isInDirection(fromRect, toRect, dir) {
    var TOLERANCE = 12;
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
    return Array.from(document.querySelectorAll('[data-focusable]')).filter(function (el) {
      if (el.disabled) return false;
      if (el.closest('[hidden]') || el.closest('.hidden')) return false;
      var style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      var rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  }

  // ── Aplicar foco visual ──────────────────────────────────────────────────
  function applyFocus(el) {
    // Limpa foco visual anterior
    var prev = document.querySelector('.tv-focus');
    if (prev && prev !== el) {
      prev.classList.remove('tv-focus');
      prev.setAttribute('aria-selected', 'false');
    }

    if (!el) return;

    el.classList.add('tv-focus');
    el.setAttribute('aria-selected', 'true');
    el.focus({ preventScroll: true });
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }

  // ── Navegação principal ───────────────────────────────────────────────────
  function navigate(dir) {
    var focusables = getFocusables();
    if (focusables.length === 0) return;

    // Fonte de verdade: document.activeElement (nunca variável interna)
    var current = document.activeElement;
    if (!current || current === document.body || current === document.documentElement) {
      applyFocus(focusables[0]);
      return;
    }

    var currentRect = current.getBoundingClientRect();
    var candidates = focusables.filter(function (el) {
      return el !== current && isInDirection(currentRect, el.getBoundingClientRect(), dir);
    });

    if (candidates.length === 0) return; // Borda — sem movimento

    var best = candidates.reduce(function (prev, el) {
      var d1 = directedDistance(currentRect, prev.getBoundingClientRect(), dir);
      var d2 = directedDistance(currentRect, el.getBoundingClientRect(), dir);
      return d2 < d1 ? el : prev;
    });

    applyFocus(best);
  }

  // ── Handler principal de teclado ─────────────────────────────────────────
  function handleKeydown(e) {
    if (!_enabled) return;

    var action = KEY_MAP[e.key] || KEY_CODE_MAP[e.keyCode];
    if (!action) return;

    // Se o teclado on-screen está aberto E quer consumir a tecla, delega
    if (_osk && typeof _osk.isOpen === 'function' && _osk.isOpen()) {
      if (typeof _osk.handleKey === 'function') {
        var consumed = _osk.handleKey(action, e);
        if (consumed) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
    }

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
        var current = document.activeElement;
        if (current && current !== document.body) {
          current.click();
        } else {
          var focusables = getFocusables();
          if (focusables.length > 0) applyFocus(focusables[0]);
        }
        break;

      case 'back':
        if (_onBack) _onBack();
        break;

      case 'playpause':
        if (_onKey) _onKey('playpause', e);
        break;

      default:
        if (_onKey) _onKey(action, e);
    }
  }

  // ── API pública ──────────────────────────────────────────────────────────
  var TVNav = {
    /**
     * Inicializa o motor de navegação.
     * @param {object} opts
     * @param {function} opts.onBack   — callback para o botão Voltar
     * @param {function} opts.onKey    — callback para teclas especiais
     */
    init: function (opts) {
      opts = opts || {};
      _onBack = opts.onBack || null;
      _onKey  = opts.onKey  || null;
      document.addEventListener('keydown', handleKeydown, true);
      // Foca o primeiro elemento após um tick para garantir DOM pronto
      setTimeout(function () {
        var els = getFocusables();
        if (els.length > 0) applyFocus(els[0]);
      }, 100);
    },

    /** Registra o componente de teclado on-screen */
    registerOSK: function (osk) {
      _osk = osk;
    },

    /** Foca um elemento específico pelo seletor ou elemento */
    focusEl: function (elOrSelector) {
      var el = typeof elOrSelector === 'string'
        ? document.querySelector(elOrSelector)
        : elOrSelector;
      if (el) applyFocus(el);
    },

    /** Foca o primeiro elemento focusável */
    focusFirst: function () {
      var els = getFocusables();
      if (els.length > 0) applyFocus(els[0]);
    },

    /** Retorna o elemento atualmente focado (document.activeElement) */
    getCurrent: function () {
      return document.activeElement;
    },

    /** Ativa/desativa a navegação */
    setEnabled: function (val) {
      _enabled = val;
    },

    /** Remove o foco visual */
    blur: function () {
      var prev = document.querySelector('.tv-focus');
      if (prev) prev.classList.remove('tv-focus');
    },

    /** Destrói o motor (remove listeners) */
    destroy: function () {
      document.removeEventListener('keydown', handleKeydown, true);
    },

    /** Re-exporta para testes */
    _getFocusables: getFocusables
  };

  global.TVNav = TVNav;
})(window);
