import React from 'react';
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import TornWindowApp from './TornWindowApp.tsx'
import './index.css'
import './i18n'

class ErrorBoundary extends React.Component<any, { hasError: boolean, error: Error | null }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("React Error Boundary caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', color: 'red', background: '#222', minHeight: '100vh', fontFamily: 'monospace' }}>
          <h2>Application Crashed</h2>
          <pre>{this.state.error?.stack || String(this.state.error)}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// A torn-off window is loaded with ?isHollow=true and gets its own lightweight root:
// none of the main window's boot hooks (crypto, auto-start, workspace init, plugins) may run there.
const isTornWindow = new URLSearchParams(window.location.search).get('isHollow') === 'true';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    {isTornWindow ? <TornWindowApp /> : <App />}
  </ErrorBoundary>
)
