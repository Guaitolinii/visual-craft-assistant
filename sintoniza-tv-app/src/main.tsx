// sintoniza-tv-app/src/main.tsx
import { render } from 'preact';
import { App } from './App';
import { ErrorBoundary } from './ErrorBoundary';
import './styles.css';

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
    root.innerHTML = `<div style="position:fixed;inset:0;background:#1a0000;color:#ffdddd;font-family:monospace;padding:48px;font-size:22px;line-height:1.5;overflow:auto">
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
