import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

// Without this, any uncaught render-time error (e.g. the invalid-date
// crash found in EmployeeDetails.tsx during the 2026-09-10 audit, or any
// future one like it) took down the entire React tree to a blank white
// screen with no way to recover except a full reload — no boundary
// existed anywhere in the app. This is a last resort, not a substitute
// for validating input at the source (which is still done at each crash
// site found).
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('Unhandled error in the app:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="login-page">
          <div className="login-card">
            <div className="subtitle" style={{ marginBottom: 12 }}>
              Something went wrong
            </div>
            <p style={{ textAlign: 'center' }}>
              An unexpected error occurred. Try reloading the page — if it keeps happening, contact your
              administrator.
            </p>
            <button className="primary-button" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
