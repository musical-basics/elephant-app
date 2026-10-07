import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { prepareLocalPianoConnection } from './lib/localPianoConnection';
import './styles.css';

const localPiano = prepareLocalPianoConnection();
// A private link can also be opened in a tab where Elephant is already running.
window.addEventListener('hashchange', () => {
  if (new URLSearchParams(window.location.hash.slice(1)).has('piano-connect')) window.location.reload();
});
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App localPiano={localPiano} /></React.StrictMode>);
