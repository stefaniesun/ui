import { defineConfig } from 'vite'
import uniModule from '@dcloudio/vite-plugin-uni'

type UniPluginFactory = () => import('vite').Plugin[]
const wrapped = uniModule as unknown as { default?: UniPluginFactory }
const uni = wrapped.default ?? (uniModule as unknown as UniPluginFactory)
export default defineConfig({ plugins: uni() })
