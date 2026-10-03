import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { installWebRunner } from './webRunner'

installWebRunner()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
