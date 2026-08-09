import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vite'

const registrationAttempts = 8
const registrationBaseDelayMs = 250

function gatewayRegistrationPlugin(): Plugin {
  return {
    name: 'roadwatch-gateway-registration',
    configureServer(server) {
      const register = () => {
        const host = server.config.server.host
        const bindHost = host === true || host === '0.0.0.0' ? '127.0.0.1' : String(host ?? '127.0.0.1')
        const port = server.config.server.port ?? 5173
        const gatewayUrl = (process.env.GATEWAY_URL ?? 'http://127.0.0.1:3100').replace(/\/$/, '')
        const registrySecret = process.env.SERVICE_REGISTRY_SECRET?.trim()
        const serviceName = process.env.SERVICE_NAME?.trim() || 'roadwatch-frontend'
        const address = `http://${bindHost}:${port}`
        const payload = {
          name: serviceName,
          address,
          healthUrl: '/',
          description: 'RoadWatch web frontend (Vite dev server)',
        }

        void (async () => {
          for (let attempt = 1; attempt <= registrationAttempts; attempt += 1) {
            try {
              const response = await fetch(`${gatewayUrl}/services/register`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...(registrySecret ? { 'x-service-registry-secret': registrySecret } : {}),
                },
                body: JSON.stringify(payload),
              })

              if (!response.ok) {
                const body = await response.text()
                throw new Error(`Service registration failed (${response.status}): ${body}`)
              }

              console.log(`[roadwatch-frontend] registered with gateway at ${address}`)
              return
            } catch (error) {
              const isLastAttempt = attempt === registrationAttempts
              if (isLastAttempt) {
                console.warn(
                  '[roadwatch-frontend] gateway registration failed:',
                  error instanceof Error ? error.message : String(error),
                )
                return
              }

              const delayMs = Math.min(registrationBaseDelayMs * 2 ** (attempt - 1), 2000)
              await new Promise((resolve) => setTimeout(resolve, delayMs))
            }
          }
        })()
      }

      if (server.httpServer?.listening) {
        register()
      } else {
        server.httpServer?.once('listening', register)
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), gatewayRegistrationPlugin()],
  // Bind to IPv4 loopback to avoid Windows IPv6/permission issues.
  server: {
    host: '127.0.0.1',
    port: Number(process.env.VITE_PORT ?? 5173),
    strictPort: false,
  },
})
