import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // Bind to IPv4 loopback to avoid Windows IPv6/permission issues.
  // Use the VITE_PORT env var (default 5173). Use strictPort so Vite
  // fails if the port is unavailable — our dev wrapper will try 5174.
  server: { host: '127.0.0.1', port: Number(process.env.VITE_PORT ?? 5173), strictPort: true },
})
