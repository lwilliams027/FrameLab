import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// `base` must match the GitHub repo name so asset URLs resolve correctly
// when served from https://<user>.github.io/<repo>/
// Change this to '/MVSIFrameData/' if deploying to that repo instead.
export default defineConfig({
  plugins: [react()],
  base: '/FrameLab/',
})
