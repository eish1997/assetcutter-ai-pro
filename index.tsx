import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import AuthGate from './components/auth/AuthGate';
import AuthShell from './components/auth/AuthShell';
import { AuthProvider } from './components/auth/AuthContext';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <AuthProvider>
      <AuthGate>
        <AuthShell>
          <App />
        </AuthShell>
      </AuthGate>
    </AuthProvider>
  </React.StrictMode>
);
