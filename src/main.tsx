import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'

// i18n - MUST be imported before App
import './i18n'

// Design tokens - MUST be imported before App
import './styles/main.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
