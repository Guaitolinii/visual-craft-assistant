// sintoniza-tv-app/src/ErrorBoundary.tsx
import { Component, type ComponentChildren } from 'preact';

interface State { error: Error | null; }

export class ErrorBoundary extends Component<{ children: ComponentChildren }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          position: 'fixed', inset: 0, background: '#1a0000', color: '#ffdddd',
          fontFamily: 'monospace', padding: 48, fontSize: 22, lineHeight: 1.5, overflow: 'auto',
        }}>
          <h1 style={{ color: '#ff6666', fontSize: 32 }}>Erro ao iniciar o Sintoniza</h1>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 18, opacity: 0.85 }}>
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
