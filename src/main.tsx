import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// vite-plugin-pwa の自動登録（injectRegister:'auto'）に加え、明示登録も可能だが
// ここでは自動登録に委ねる（外部通信は一切発生しない）。

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
