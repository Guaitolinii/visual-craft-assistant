// sintoniza-tv-app/src/main.tsx
import { render } from 'preact';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { App } from './App';
import { ErrorBoundary } from './ErrorBoundary';
import './styles.css';

// Sem isso, TODO uso de useFocusable() (em qualquer componente) quebra com
// "Cannot read property 'measureLayout' of undefined" assim que tenta medir
// a posição de um elemento na tela - a biblioteca só cria o adaptador de
// layout dentro do próprio init(), e sem chamá-lo aqui (nos testes,
// cada arquivo já chama isso sozinho no beforeEach) nada nunca é criado.
init({ debug: false, visualDebug: false });

// Rede de segurança global: cobre erros que o Error Boundary do React/Preact
// NÃO pega (erros em event handlers, callbacks assíncronos, Promises sem
// .catch) - ver Tarefa 6 e docs/superpowers/plans/
// 2026-09-25-tv-app-boot-crash-e-boas-praticas.md, seção 2.3.
let fatalShown = false;
function showFatal(label: string, detail: string) {
  if (fatalShown) return;
  fatalShown = true;
  const root = document.getElementById('root');
  if (root) {
    // top/right/bottom/left em vez de "inset" (não suportado pelo
    // Chromium desta TV - mesma correção já aplicada no app vanilla em
    // sintoniza-tv/tv-styles.css).
    root.innerHTML = `<div style="position:fixed;top:0;right:0;bottom:0;left:0;background:#1a0000;color:#ffdddd;font-family:monospace;padding:48px;font-size:22px;line-height:1.5;overflow:auto">
      <h1 style="color:#ff6666;font-size:32px">Erro ao iniciar o Sintoniza</h1>
      <pre style="white-space:pre-wrap;word-break:break-word;font-size:18px;opacity:.85">${label}\n\n${detail}</pre>
    </div>`;
  }
}
window.addEventListener('error', (e) => {
  showFatal('Erro de JavaScript', `${e.filename || '?'}:${e.lineno || '?'}:${e.colno || '?'}\n${e.message || 'sem mensagem'}`);
});
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason;
  showFatal('Promise rejeitada sem tratamento', (reason && reason.stack) || (reason && reason.message) || String(reason));
});

const root = document.getElementById('root')!;
render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
  root
);
