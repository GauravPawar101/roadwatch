import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AuthProvider } from './contexts/AuthContext'
import './index.css'

const RealtimeEventBridge = React.lazy(() => import('./components/RealtimeEventBridge'))

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

const queryClient = new QueryClient()

createRoot(root).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
          <App />
          <React.Suspense fallback={null}>
            {/* Mount the runtime bridge once for the whole SPA */}
            <RealtimeEventBridge />
          </React.Suspense>
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>
)
