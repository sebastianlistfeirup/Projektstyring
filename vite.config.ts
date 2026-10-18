import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Eksponér dev-serveren på netværket, så app'en kan testes fra telefonen
  // på samme Wi-Fi (http://<PC-IP>:5173).
  server: { host: true },
})
