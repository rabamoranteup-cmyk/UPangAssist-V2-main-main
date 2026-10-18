import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import process from 'node:process'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        // Use IPv4 explicitly so the proxy does not depend on how the OS resolves
        // `localhost` (which may prefer IPv6 while the API listens on IPv4).
        target: process.env.API_TARGET || 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
})
