import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { getRecord, saveRecord } from '../lib/offlineStore'
import {
    connectGatewayRealtimeStream,
    fetchComplaintSnapshot,
    getComplaintEventName,
    getComplaintRefreshEventName,
    getNotificationEventName,
    getNotificationRefreshEventName,
    type GatewayComplaintEvent,
    type GatewayNotificationEvent,
} from '../lib/realtimeEvents'

function notificationTypeFromGateway(notifType: string): 'info' | 'warning' | 'error' | 'success' {
  const normalized = notifType.toLowerCase()
  if (normalized.includes('error') || normalized.includes('alert') || normalized.includes('critical')) return 'error'
  if (normalized.includes('warning') || normalized.includes('sla') || normalized.includes('breach')) return 'warning'
  if (normalized.includes('success') || normalized.includes('resolved') || normalized.includes('closed')) return 'success'
  return 'info'
}

export default function RealtimeEventBridge() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const emitComplaintEvent = async (event: GatewayComplaintEvent) => {
      window.dispatchEvent(new CustomEvent(getComplaintEventName(), { detail: event }))

      const snapshot = await fetchComplaintSnapshot(event.complaint.id)
      if (snapshot) {
        const existing = await getRecord<Record<string, unknown>>('complaints', snapshot.id)
        const nextRecord = {
          ...(existing ?? {}),
          ...snapshot,
          location: existing && typeof existing.location === 'object' ? existing.location : snapshot.lat != null && snapshot.lng != null ? { lat: snapshot.lat, lng: snapshot.lng } : undefined,
        }

        await saveRecord('complaints', snapshot.id, nextRecord)
        window.dispatchEvent(new Event(getComplaintRefreshEventName()))
      }

      await queryClient.invalidateQueries({
        predicate: (query) => {
          const [scope] = query.queryKey
          return scope === 'roadwatch-dashboard' || scope === 'public-contractor-scorecard' || scope === 'public-proposal-intelligence'
        },
      })
    }

    const emitNotificationEvent = async (event: GatewayNotificationEvent) => {
      window.dispatchEvent(new CustomEvent(getNotificationEventName(), { detail: event }))

      const existing = JSON.parse(localStorage.getItem('roadwatch_notifications') || '[]') as Array<Record<string, unknown>>
      const normalized = {
        id: event.notification.id,
        title: event.notification.title,
        message: event.notification.body,
        type: notificationTypeFromGateway(event.notification.notifType),
        read: Boolean(event.notification.readAt),
        createdAt: event.notification.createdAt,
        metadata: {
          inboxId: event.notification.inboxId,
          district: event.notification.district,
          zone: event.notification.zone,
          roadId: event.notification.roadId,
          critical: event.notification.critical,
          notifType: event.notification.notifType,
        },
      }

      const nextNotifications = [normalized, ...existing.filter((item) => item.id !== normalized.id)]
      localStorage.setItem('roadwatch_notifications', JSON.stringify(nextNotifications))
      window.dispatchEvent(new Event(getNotificationRefreshEventName()))
      await queryClient.invalidateQueries({ queryKey: ['notifications'] })
    }

    return connectGatewayRealtimeStream({
      onComplaintEvent: emitComplaintEvent,
      onNotificationEvent: emitNotificationEvent,
      onError: () => {
        // The browser auto-retries EventSource connections; keep the UI quiet on transient disconnects.
      },
    })
  }, [queryClient])

  return null
}
