import type { Response } from 'express';
import type { JwtClaims } from '../auth/jwt.js';
import { assertDistrictAccess, assertZoneAccess } from '../rbac.js';

type Client = {
  res: Response;
  user: JwtClaims;
};

const clients = new Set<Client>();

export function addSseClient(params: { res: Response; user: JwtClaims }): () => void {
  clients.add({ res: params.res, user: params.user });
  return () => {
    for (const c of clients) {
      if (c.res === params.res) clients.delete(c);
    }
  };
}

export type ComplaintEvent = {
  type: 'complaint_created' | 'complaint_updated' | 'complaint_resolved';
  complaint: {
    id: string;
    district: string;
    zone: string;
    status: string;
    description: string;
    lat: number | null;
    lng: number | null;
    updatedAt: string;
  };
};

export function broadcastComplaintEvent(event: ComplaintEvent) {
  const data = JSON.stringify(event);
  for (const c of clients) {
    if (!assertDistrictAccess(c.user, event.complaint.district)) continue;
    if (!assertZoneAccess(c.user, event.complaint.zone)) continue;
    c.res.write(`event: ${event.type}\n`);
    c.res.write(`data: ${data}\n\n`);
  }
}

export type NotificationEvent = {
  type: 'notification_created';
  notification: {
    inboxId: string;
    id: string;
    notifType: string;
    title: string;
    body: string;
    district: string | null;
    zone: string | null;
    roadId: string | null;
    critical: boolean;
    createdAt: string;
    readAt: string | null;
  };
};

export function broadcastNotificationEvent(params: {
  userId: string;
  district: string | null;
  zone: string | null;
  event: NotificationEvent;
}) {
  const data = JSON.stringify(params.event);
  for (const c of clients) {
    if (c.user.sub !== params.userId) continue;
    if (params.district && !assertDistrictAccess(c.user, params.district)) continue;
    if (params.zone && !assertZoneAccess(c.user, params.zone)) continue;
    c.res.write(`event: notification_created\n`);
    c.res.write(`data: ${data}\n\n`);
  }
}
