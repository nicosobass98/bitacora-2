import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import './ui/estilos.css';

// La app tiene que funcionar en un sótano sin cobertura: el shell se precachea y
// se actualiza solo cuando hay red.
registerSW({ immediate: true });

const raiz = document.getElementById('root');
if (!raiz) throw new Error('Falta el nodo #root');

createRoot(raiz).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
