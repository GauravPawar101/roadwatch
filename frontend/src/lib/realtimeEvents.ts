export type GatewayComplaintEvent = {
  type: 'complaint_created' | 'complaint_updated' | 'complaint_resolved'
  complaint: {
    id: string
    district: string
    zone: string
    status: string
    description: string
    lat: number | null
    lng: number | null
    updatedAt: string
  }
}

export type GatewayNotificationEvent = {
  type: 'notification_created'
  notification: {
    inboxId: string
    id: string
    notifType: string
    title: string
    body: string
    district: string | null
    zone: string | null
    roadId: string | null
    critical: boolean
    createdAt: string
    readAt: string | null
  }
}

const complaintEventName = 'roadwatch:complaint-event'
const complaintRefreshEventName = 'roadwatch:complaints-updated'
const notificationEventName = 'roadwatch:notification-event'
const notificationRefreshEventName = 'roadwatch:notifications-updated'

function getApiBase() {
  return ((import.meta as any).env?.VITE_API_BASE as string | undefined) || 'http://localhost:3100'
}

function getToken() {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem('roadwatch_token') || ''
}

export function getComplaintEventName() {
  return complaintEventName
}

export function getComplaintRefreshEventName() {
  return complaintRefreshEventName
}

export function getNotificationEventName() {
  return notificationEventName
}

export function getNotificationRefreshEventName() {
  return notificationRefreshEventName
}

export async function fetchComplaintSnapshot(complaintId: string) {
  const token = getToken()
  if (!token) return null

  const response = await fetch(`${getApiBase()}/complaints/${encodeURIComponent(complaintId)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    return null
  }

  return await response.json()
}

export function connectGatewayRealtimeStream(onEvent: {
  onComplaintEvent?: (event: GatewayComplaintEvent) => void
  onNotificationEvent?: (event: GatewayNotificationEvent) => void
  onReady?: () => void
  onError?: () => void
}) {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
    return () => undefined
  }

  const token = getToken()
  if (!token) {
    return () => undefined
  }

  const source = new EventSource(`${getApiBase()}/events?token=${encodeURIComponent(token)}`)

  const complaintHandler = (event: MessageEvent<string>) => {
    try {
      onEvent.onComplaintEvent?.(JSON.parse(event.data) as GatewayComplaintEvent)
    } catch (error) {
      console.error('Failed to parse complaint event', error)
    }
  }

  const notificationHandler = (event: MessageEvent<string>) => {
    try {
      onEvent.onNotificationEvent?.(JSON.parse(event.data) as GatewayNotificationEvent)
    } catch (error) {
      console.error('Failed to parse notification event', error)
    }
  }

  source.addEventListener('ready', () => onEvent.onReady?.())
  source.addEventListener('complaint_created', complaintHandler as EventListener)
  source.addEventListener('complaint_updated', complaintHandler as EventListener)
  source.addEventListener('complaint_resolved', complaintHandler as EventListener)
  source.addEventListener('notification_created', notificationHandler as EventListener)
  source.onerror = () => onEvent.onError?.()

  return () => source.close()
}
