import { getEnv } from '../env.js';
import type { NotificationChannel } from './domain.js';
import { fcmTopicForJurisdiction, fcmTopicForRoad, fcmTopicForUser } from './domain.js';

type SendParams = {
  channel: NotificationChannel;
  phone: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  userId: string;
  district: string | null;
  zone: string | null;
  roadId: string | null;
};

export async function sendViaChannel(params: SendParams): Promise<void> {
  switch (params.channel) {
    case 'IN_APP':
      return;
    case 'FCM':
      return sendFcm(params);
    case 'SMS':
      return sendSms(params);
    case 'WHATSAPP':
      return sendWhatsapp(params);
    default: {
      const _exhaustive: never = params.channel;
      return _exhaustive;
    }
  }
}

async function sendFcm(params: SendParams): Promise<void> {
  const env = getEnv();
  const serverKey = env.FCM_SERVER_KEY;
  if (!serverKey) throw new Error('FCM not configured (FCM_SERVER_KEY missing)');

  const topics = [fcmTopicForUser(params.userId)];
  if (params.district) topics.push(fcmTopicForJurisdiction({ district: params.district, zone: params.zone ?? undefined }));
  if (params.roadId) topics.push(fcmTopicForRoad(params.roadId));

  // Send only to user topic by default to avoid over-broadcast.
  const to = `/topics/${topics[0]}`;

  const r = await fetch('https://fcm.googleapis.com/fcm/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `key=${serverKey}`
    },
    body: JSON.stringify({
      to,
      notification: { title: params.title, body: params.body },
      data: coerceStringMap(params.data)
    })
  });

  if (!r.ok) {
    const t = await r.text();
    throw new Error(`FCM send failed: ${r.status} ${t}`);
  }
}

async function sendSms(params: SendParams): Promise<void> {
  const env = getEnv();
  const provider = (env.SMS_PROVIDER ?? 'twilio').toLowerCase();
  if (provider === 'twilio') return sendTwilioSms(params);
  if (provider === 'msg91') return sendMsg91Sms(params);
  throw new Error('SMS provider not configured (SMS_PROVIDER)');
}

async function sendWhatsapp(params: SendParams): Promise<void> {
  const env = getEnv();
  const provider = (env.WHATSAPP_PROVIDER ?? 'twilio').toLowerCase();
  if (provider === 'twilio') return sendTwilioWhatsapp(params);
  throw new Error('WhatsApp provider not configured (WHATSAPP_PROVIDER)');
}

async function sendTwilioSms(params: SendParams): Promise<void> {
  const env = getEnv();
  const sid = env.TWILIO_ACCOUNT_SID;
  const token = env.TWILIO_AUTH_TOKEN;
  const from = env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) throw new Error('Twilio SMS not configured');

  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`;
  const body = new URLSearchParams({
    From: from,
    To: params.phone,
    Body: `${params.title}\n${params.body}`
  });

  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Twilio SMS failed: ${r.status} ${t}`);
  }
}

async function sendTwilioWhatsapp(params: SendParams): Promise<void> {
  const env = getEnv();
  const sid = env.TWILIO_ACCOUNT_SID;
  const token = env.TWILIO_AUTH_TOKEN;
  const from = env.TWILIO_WHATSAPP_FROM;
  if (!sid || !token || !from) throw new Error('Twilio WhatsApp not configured');

  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`;
  const body = new URLSearchParams({
    From: from,
    To: `whatsapp:${params.phone}`,
    Body: `${params.title}\n${params.body}`
  });

  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Twilio WhatsApp failed: ${r.status} ${t}`);
  }
}

async function sendMsg91Sms(params: SendParams): Promise<void> {
  const env = getEnv();
  const authKey = env.MSG91_AUTH_KEY;
  const senderId = env.MSG91_SENDER_ID;
  if (!authKey || !senderId) throw new Error('MSG91 not configured');

  // Minimal transactional SMS call. Template-based setups vary; keep as a plain-text placeholder.
  const r = await fetch('https://api.msg91.com/api/v2/sendsms', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      authkey: authKey
    },
    body: JSON.stringify({
      sender: senderId,
      route: '4',
      country: '91',
      sms: [
        {
          message: `${params.title}\n${params.body}`,
          to: [params.phone.replace(/^\+/, '')]
        }
      ]
    })
  });

  if (!r.ok) {
    const t = await r.text();
    throw new Error(`MSG91 SMS failed: ${r.status} ${t}`);
  }
}

function coerceStringMap(input: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return out;
}
