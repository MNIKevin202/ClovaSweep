import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles/theme.css'
import './styles/app.css'
import App from './App'
import { initClovaBridge } from './lib/clovaBridge'

// window.clova needs one round trip (fetching the platform) before it's
// ready, so we await it here rather than inside App — every page assumes
// window.clova already exists the moment it mounts.
initClovaBridge().then(() => {
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
})
