export type Role = 'CE' | 'EE' | 'CITIZEN';

export type AuthedUser = {
  id: string;
  phone: string;
  phoneHash?: string;
  role: Role;
  govtId?: string | null;
  districts: string[];
  zones: string[];
};

export type Complaint = {
  id: string;
  district: string;
  zone: string;
  status: string;
  description: string;
  lat: number | null;
  lng: number | null;
  updated_at?: string;
};

export type NotificationChannel = 'IN_APP' | 'FCM' | 'SMS' | 'WHATSAPP';
export type AuthorityBatchingPreference = 'IMMEDIATE' | 'DAILY_DIGEST';
export type NotificationPreferences = {
  userId: string;
  enabledChannels: NotificationChannel[];
  doNotDisturb: {
    enabled: boolean;
    startMinutes: number;
    endMinutes: number;
    timeZone: string;
  };
  authorityBatching: AuthorityBatchingPreference;
  digestMinutes: number;
};

export type InboxItem = {
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

export type PublicChronicRoadItem = {
  complaintId: string;
  district: string;
  zone: string;
  status: string;
  description: string;
  lat: number | null;
  lng: number | null;
  createdAt: string;
  ageDays: number;
};

export type PublicHotspotCluster = {
  key: string;
  count: number;
  centroid: { lat: number; lng: number };
  districts: string[];
  zones: string[];
  complaintIds: string[];
};

export type PublicTrend = {
  key: string;
  recentCount: number;
  previousCount: number;
  openCount: number;
  score: number;
  centroid: { lat: number; lng: number } | null;
};

export type ContractorScorecardRow = {
  contractorId: string;
  contractorName: string;
  assignedCount: number;
  resolvedCount: number;
  openCount: number;
  avgResolutionDays: number | null;
  slaBreaches: number;
  onTimeRate: number | null;
};

export type PublicDashboard = {
  generatedAt: string;
  scope: { district: string | null; zone: string | null };
  roadHealthIndex: number;
  totals: { total: number };
  byStatus: Record<string, number>;
  chronic: { rule: string; chronicDays: number; items: PublicChronicRoadItem[] };
  hotspots: PublicHotspotCluster[];
  trends: PublicTrend[];
  contractorScorecard: ContractorScorecardRow[];
};

export type RoadAssignmentInfo = {
  contractorId: string | null;
  contractorName: string | null;
  contractorPhoneMasked: string | null;
  engineerUserId: string | null;
  engineerGovtId: string | null;
  startsOn: string | null; // YYYY-MM-DD
  endsOn: string | null; // YYYY-MM-DD
};

export type RoadAuthorityInfo = {
  name: string | null;
  department: string | null;
  publicPhone: string | null;
  publicEmail: string | null;
  website: string | null;
  address: string | null;
};

export type RoadSegmentProperties = {
  roadId: string;
  name: string;
  roadType: string;
  authorityId: string;
  districtCode: string;
  assignment: RoadAssignmentInfo;
  authority: RoadAuthorityInfo;
};

export type RoadSegmentsGeoJson = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: any;
    properties: RoadSegmentProperties;
  }>;
};

const API_BASE = (import.meta as any).env?.VITE_API_BASE ?? 'http://localhost:3000';

async function throwApiError(r: Response, fallback: string): Promise<never> {
  try {
    const json = await r.clone().json();
    const msg = (json as any)?.error;
    if (typeof msg === 'string' && msg.trim()) {
      throw new Error(msg);
    }
  } catch (e: any) {
    if (e instanceof Error && e.message) throw e;
  }

  const text = await r.text().catch(() => '');
  throw new Error(text?.trim() ? text.trim() : fallback);
}

function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function requestOtp(phone: string): Promise<{ sessionId: string; devCode?: string }> {
  const r = await fetch(`${API_BASE}/auth/otp/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone })
  });
  if (!r.ok) await throwApiError(r, 'OTP request failed');
  return r.json();
}

export async function verifyOtp(params: {
  phone: string;
  sessionId: string;
  code: string;
}): Promise<{ token: string; user: AuthedUser }> {
  const r = await fetch(`${API_BASE}/auth/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  if (!r.ok) await throwApiError(r, 'OTP verification failed');
  return r.json();
}

export async function requestCitizenOtp(phone: string): Promise<{ sessionId: string; devCode?: string }> {
  const r = await fetch(`${API_BASE}/auth/citizen/otp/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone })
  });
  if (!r.ok) await throwApiError(r, 'OTP request failed');
  return r.json();
}

export async function verifyCitizenOtp(params: {
  phone: string;
  sessionId: string;
  code: string;
}): Promise<{ token: string; user: AuthedUser }> {
  const r = await fetch(`${API_BASE}/auth/citizen/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  if (!r.ok) await throwApiError(r, 'OTP verification failed');
  return r.json();
}

export type AdminUserRow = {
  id: string;
  phone: string;
  govtId: string | null;
  role: 'CE' | 'EE';
  districts: string[];
  zones: string[];
  createdAt: string;
};

export async function listAdminUsers(token: string, params?: { limit?: number }): Promise<AdminUserRow[]> {
  const url = new URL(`${API_BASE}/admin/users`);
  if (params?.limit) url.searchParams.set('limit', String(params.limit));
  const r = await fetch(url.toString(), { headers: { ...authHeaders(token) } });
  if (!r.ok) await throwApiError(r, 'Failed to load users');
  const json = await r.json();
  return json.users as AdminUserRow[];
}

export async function createAdminUser(token: string, params: {
  phone: string;
  role: 'CE' | 'EE';
  govtId?: string;
  districts?: string[];
  zones?: string[];
}): Promise<{ id: string; phone: string; govtId: string | null; role: 'CE' | 'EE'; districts: string[]; zones: string[] }> {
  const r = await fetch(`${API_BASE}/admin/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify(params)
  });
  if (!r.ok) await throwApiError(r, 'Failed to create user');
  const json = await r.json();
  return json.user as any;
}

export async function listComplaints(token: string, params?: { status?: string }): Promise<Complaint[]> {
  const url = new URL(`${API_BASE}/authority/complaints`);
  if (params?.status) url.searchParams.set('status', params.status);
  const r = await fetch(url.toString(), { headers: { ...authHeaders(token) } });
  if (!r.ok) throw new Error('Failed to load complaints');
  const json = await r.json();
  return json.complaints as Complaint[];
}

export async function resolveComplaint(token: string, id: string, resolutionNote?: string): Promise<void> {
  const r = await fetch(`${API_BASE}/authority/complaints/${encodeURIComponent(id)}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ resolutionNote })
  });
  if (!r.ok) throw new Error('Failed to resolve complaint');
}

export async function getAnalytics(token: string): Promise<{ byStatus: Record<string, number>; totals: { total: number } }> {
  const r = await fetch(`${API_BASE}/authority/analytics`, { headers: { ...authHeaders(token) } });
  if (!r.ok) throw new Error('Failed to load analytics');
  return r.json();
}

export async function getBudget(token: string, district?: string): Promise<any> {
  const url = new URL(`${API_BASE}/authority/budget`);
  if (district) url.searchParams.set('district', district);
  const r = await fetch(url.toString(), { headers: { ...authHeaders(token) } });
  if (!r.ok) throw new Error('Failed to load budget');
  return r.json();
}

export async function getAudit(token: string): Promise<any[]> {
  const r = await fetch(`${API_BASE}/authority/audit`, { headers: { ...authHeaders(token) } });
  if (!r.ok) throw new Error('Failed to load audit log');
  const json = await r.json();
  return json.entries;
}

export function districtReportUrl(token: string, district: string): string {
  // Use token query param so the download works in a plain anchor.
  return `${API_BASE}/reports/district/${encodeURIComponent(district)}.pdf?token=${encodeURIComponent(token)}`;
}

export function eventsUrl(token: string): string {
  return `${API_BASE}/events?token=${encodeURIComponent(token)}`;
}

export async function getNotificationInbox(token: string, limit: number = 50): Promise<InboxItem[]> {
  const url = new URL(`${API_BASE}/notifications/inbox`);
  url.searchParams.set('limit', String(limit));
  const r = await fetch(url.toString(), { headers: { ...authHeaders(token) } });
  if (!r.ok) throw new Error('Failed to load notifications');
  const json = await r.json();
  return json.items as InboxItem[];
}

export async function markNotificationRead(token: string, inboxId: string): Promise<void> {
  const r = await fetch(`${API_BASE}/notifications/inbox/${encodeURIComponent(inboxId)}/read`, {
    method: 'POST',
    headers: { ...authHeaders(token) }
  });
  if (!r.ok) throw new Error('Failed to mark notification read');
}

export async function getNotificationPreferences(token: string): Promise<NotificationPreferences> {
  const r = await fetch(`${API_BASE}/notifications/preferences`, { headers: { ...authHeaders(token) } });
  if (!r.ok) throw new Error('Failed to load notification preferences');
  const json = await r.json();
  return json.preferences as NotificationPreferences;
}

export async function updateNotificationPreferences(
  token: string,
  patch: Partial<NotificationPreferences>
): Promise<NotificationPreferences> {
  const r = await fetch(`${API_BASE}/notifications/preferences`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify(patch)
  });
  if (!r.ok) throw new Error('Failed to update notification preferences');
  const json = await r.json();
  return json.preferences as NotificationPreferences;
}

export async function getNotificationTopics(token: string): Promise<{ userTopic: string; jurisdictionTopics: string[] }> {
  const r = await fetch(`${API_BASE}/notifications/topics`, { headers: { ...authHeaders(token) } });
  if (!r.ok) throw new Error('Failed to load topics');
  const json = await r.json();
  return json.topics as { userTopic: string; jurisdictionTopics: string[] };
}

// ---------------------------------------------------------------------------
// Public dashboard (no-login)
// ---------------------------------------------------------------------------

export async function getPublicDashboard(params?: {
  district?: string;
  zone?: string;
  chronicDays?: number;
}): Promise<PublicDashboard> {
  const url = new URL(`${API_BASE}/public/dashboard`);
  if (params?.district) url.searchParams.set('district', params.district);
  if (params?.zone) url.searchParams.set('zone', params.zone);
  if (typeof params?.chronicDays === 'number') url.searchParams.set('chronicDays', String(params.chronicDays));
  const r = await fetch(url.toString());
  if (!r.ok) throw new Error('Failed to load public dashboard');
  return r.json();
}

export function publicExportCsvUrl(params?: { chronicOnly?: boolean; chronicDays?: number }): string {
  const url = new URL(`${API_BASE}/public/export/roads.csv`);
  if (typeof params?.chronicOnly === 'boolean') url.searchParams.set('chronicOnly', String(params.chronicOnly));
  if (typeof params?.chronicDays === 'number') url.searchParams.set('chronicDays', String(params.chronicDays));
  return url.toString();
}

export function publicExportGeoJsonUrl(params?: { chronicOnly?: boolean; chronicDays?: number }): string {
  const url = new URL(`${API_BASE}/public/export/roads.geojson`);
  if (typeof params?.chronicOnly === 'boolean') url.searchParams.set('chronicOnly', String(params.chronicOnly));
  if (typeof params?.chronicDays === 'number') url.searchParams.set('chronicDays', String(params.chronicDays));
  return url.toString();
}

export function publicExportPdfUrl(params?: { district?: string; zone?: string; chronicDays?: number }): string {
  const url = new URL(`${API_BASE}/public/export/roads.pdf`);
  if (params?.district) url.searchParams.set('district', params.district);
  if (params?.zone) url.searchParams.set('zone', params.zone);
  if (typeof params?.chronicDays === 'number') url.searchParams.set('chronicDays', String(params.chronicDays));
  return url.toString();
}

// ---------------------------------------------------------------------------
// Road segments overlay + citizen complaint submission
// ---------------------------------------------------------------------------

export async function getRoadSegmentsGeoJson(params: {
  districtId?: string;
  lat?: number;
  lng?: number;
  limit?: number;
}): Promise<RoadSegmentsGeoJson> {
  const url = new URL(`${API_BASE}/public/roads/segments.geojson`);
  if (params.districtId) url.searchParams.set('districtId', params.districtId);
  if (typeof params.lat === 'number') url.searchParams.set('lat', String(params.lat));
  if (typeof params.lng === 'number') url.searchParams.set('lng', String(params.lng));
  if (typeof params.limit === 'number') url.searchParams.set('limit', String(params.limit));
  const r = await fetch(url.toString());
  if (!r.ok) return throwApiError(r, 'Failed to load road segments');
  return r.json();
}

export async function createCitizenComplaint(token: string, input: {
  roadId: string;
  description: string;
  lat: number;
  lng: number;
  image?: File | null;
}): Promise<{ id: string }> {
  const form = new FormData();
  form.set('roadId', input.roadId);
  form.set('description', input.description);
  form.set('lat', String(input.lat));
  form.set('lng', String(input.lng));
  if (input.image) form.set('image', input.image);

  const r = await fetch(`${API_BASE}/citizen/complaints`, {
    method: 'POST',
    headers: { ...authHeaders(token) },
    body: form
  });
  if (!r.ok) return throwApiError(r, 'Failed to create complaint');
  const json = await r.json();
  return { id: json?.complaint?.id };
}
