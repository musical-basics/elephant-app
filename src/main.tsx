import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { prepareLocalPianoConnection } from './lib/localPianoConnection';
import './styles.css';

const localPiano = prepareLocalPianoConnection();
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App localPiano={localPiano} /></React.StrictMode>);
