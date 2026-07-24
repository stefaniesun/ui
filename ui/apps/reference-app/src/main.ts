import { createSSRApp } from 'vue'
import App from './App.vue'
import './styles/tokens.scss'
export function createApp() { return { app: createSSRApp(App) } }
