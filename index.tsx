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
// Avoid React.StrictMode remounting WebGL/3D viewers (ImageModel3DViewer): in DEV it
// mount→unmount→remount after a cache-fast ready frame, which flashes「加载中」and drops the PBR panel.
root.render(
  <AuthProvider>
    <AuthGate>
      <AuthShell>
        <App />
      </AuthShell>
    </AuthGate>
  </AuthProvider>
);
