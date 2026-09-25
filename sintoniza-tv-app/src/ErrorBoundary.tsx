import { Component, type ComponentChildren } from 'preact';

export class ErrorBoundary extends Component<{ children: ComponentChildren }> {
  render() {
    return this.props.children;
  }
}
