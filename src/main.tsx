import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initPwa } from './pwa';
import './styles.css';

// SW登録と更新確認は src/pwa.ts が制御する。
// 1日以内の再起動では register() を呼ばない＝通信ゼロ（既存SWがオフライン動作を提供）。
initPwa();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
