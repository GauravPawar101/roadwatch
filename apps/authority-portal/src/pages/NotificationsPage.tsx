import { useEffect, useMemo, useState } from 'react';
import {
    getNotificationInbox,
    getNotificationPreferences,
    getNotificationTopics,
    markNotificationRead,
    updateNotificationPreferences,
    type InboxItem,
    type NotificationChannel,
    type NotificationPreferences
} from '../api';
import { getToken } from '../auth';

function minutesToTime(m: number): string {
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

function timeToMinutes(v: string): number {
  const parts = v.split(':');
  const hh = parts[0] ?? '0';
  const mm = parts[1] ?? '0';
  const hRaw = Number(hh);
  const mRaw = Number(mm);
  const h = Number.isFinite(hRaw) ? hRaw : 0;
  const m = Number.isFinite(mRaw) ? mRaw : 0;
  return Math.max(0, Math.min(1439, h * 60 + m));
}

const ALL_CHANNELS: NotificationChannel[] = ['IN_APP', 'FCM', 'WHATSAPP', 'SMS'];

export function NotificationsPage() {
  const token = getToken();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [topics, setTopics] = useState<{ userTopic: string; jurisdictionTopics: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const unreadCount = useMemo(() => items.filter((i) => !i.readAt).length, [items]);

  async function reload() {
    if (!token) return;
    const [inbox, p, t] = await Promise.all([
      getNotificationInbox(token, 100),
      getNotificationPreferences(token),
      getNotificationTopics(token)
    ]);
    setItems(inbox);
    setPrefs(p);
    setTopics(t);
  }

  useEffect(() => {
    if (!token) return;
    reload().catch((e: any) => setError(e?.message ?? 'Failed'));
  }, [token]);

  async function toggleChannel(ch: NotificationChannel) {
    if (!prefs) return;
    const next = new Set(prefs.enabledChannels);
    if (ch === 'IN_APP') {
      next.add('IN_APP');
    } else if (next.has(ch)) {
      next.delete(ch);
    } else {
      next.add(ch);
    }
    setPrefs({ ...prefs, enabledChannels: Array.from(next) as NotificationChannel[] });
  }

  async function save() {
    if (!token || !prefs) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateNotificationPreferences(token, prefs);
      setPrefs(updated);
    } catch (e: any) {
      setError(e?.message ?? 'Failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <h2>Notifications</h2>
      <p className="muted">Inbox history + channel preferences. Unread: {unreadCount}</p>

      {error ? <div style={{ marginBottom: 12 }} className="muted">{error}</div> : null}

      <div className="row" style={{ marginBottom: 16 }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Preferences</h3>
          {!prefs ? (
            <div className="muted">Loading…</div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <div className="muted" style={{ marginBottom: 6 }}>Channels</div>
                  {ALL_CHANNELS.map((ch) => (
                    <label key={ch} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                      <input
                        type="checkbox"
                        checked={prefs.enabledChannels.includes(ch)}
                        disabled={ch === 'IN_APP'}
                        onChange={() => toggleChannel(ch)}
                        style={{ width: 16, height: 16 }}
                      />
                      <span>{ch}</span>
                    </label>
                  ))}
                  <div className="muted" style={{ fontSize: 12 }}>
                    IN_APP is always enabled (in-app notification center).
                  </div>
                </div>

                <div>
                  <div className="muted" style={{ marginBottom: 6 }}>Do-not-disturb</div>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                    <input
                      type="checkbox"
                      checked={prefs.doNotDisturb.enabled}
                      onChange={(e) => setPrefs({ ...prefs, doNotDisturb: { ...prefs.doNotDisturb, enabled: e.target.checked } })}
                      style={{ width: 16, height: 16 }}
                    />
                    <span>Enable quiet hours</span>
                  </label>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Start</div>
                      <input
                        type="time"
                        value={minutesToTime(prefs.doNotDisturb.startMinutes)}
                        onChange={(e) =>
                          setPrefs({
                            ...prefs,
                            doNotDisturb: { ...prefs.doNotDisturb, startMinutes: timeToMinutes(e.target.value) }
                          })
                        }
                      />
                    </div>
                    <div>
                      <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>End</div>
                      <input
                        type="time"
                        value={minutesToTime(prefs.doNotDisturb.endMinutes)}
                        onChange={(e) =>
                          setPrefs({
                            ...prefs,
                            doNotDisturb: { ...prefs.doNotDisturb, endMinutes: timeToMinutes(e.target.value) }
                          })
                        }
                      />
                    </div>
                  </div>

                  <div style={{ marginTop: 10 }}>
                    <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Time zone (IANA)</div>
                    <input
                      value={prefs.doNotDisturb.timeZone}
                      onChange={(e) => setPrefs({ ...prefs, doNotDisturb: { ...prefs.doNotDisturb, timeZone: e.target.value } })}
                      placeholder="Asia/Kolkata"
                    />
                  </div>
                </div>
              </div>

              <div style={{ borderTop: '1px solid var(--border)', marginTop: 14, paddingTop: 14 }}>
                <div className="muted" style={{ marginBottom: 6 }}>Authority batching</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <select
                      value={prefs.authorityBatching}
                      onChange={(e) => setPrefs({ ...prefs, authorityBatching: e.target.value as any })}
                      style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid var(--border)' }}
                    >
                      <option value="IMMEDIATE">Immediate</option>
                      <option value="DAILY_DIGEST">Daily digest</option>
                    </select>
                  </div>
                  <div>
                    <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Digest time</div>
                    <input
                      type="time"
                      value={minutesToTime(prefs.digestMinutes)}
                      onChange={(e) => setPrefs({ ...prefs, digestMinutes: timeToMinutes(e.target.value) })}
                    />
                  </div>
                </div>
                <div style={{ marginTop: 12, display: 'flex', gap: 10 }}>
                  <button disabled={!prefs || saving} onClick={save}>
                    {saving ? 'Saving…' : 'Save preferences'}
                  </button>
                  <button className="secondary" disabled={!token} onClick={() => reload()}>
                    Reload
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>FCM topic structure</h3>
          {!topics ? (
            <div className="muted">Loading…</div>
          ) : (
            <>
              <div className="muted">User topic</div>
              <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', marginBottom: 12 }}>
                {topics.userTopic}
              </div>

              <div className="muted">Jurisdiction topics</div>
              <ul>
                {topics.jurisdictionTopics.slice(0, 20).map((t) => (
                  <li key={t} style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>{t}</li>
                ))}
              </ul>
              {topics.jurisdictionTopics.length > 20 ? (
                <div className="muted">Showing first 20.</div>
              ) : null}
            </>
          )}
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Inbox</h3>
        <table>
          <thead>
            <tr>
              <th style={{ width: 160 }}>When</th>
              <th>Message</th>
              <th style={{ width: 160 }}>Scope</th>
              <th style={{ width: 120 }} />
            </tr>
          </thead>
          <tbody>
            {items.map((n) => (
              <tr key={n.inboxId} style={{ fontWeight: n.readAt ? undefined : 700 }}>
                <td>
                  {new Date(n.createdAt).toLocaleString()}
                  <div className="muted">{n.notifType}</div>
                </td>
                <td>
                  {n.title}
                  <div className="muted">{n.body}</div>
                </td>
                <td>
                  {n.district ? (
                    <>
                      {n.district}
                      <div className="muted">{n.zone ?? ''}</div>
                    </>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  {n.readAt ? (
                    <span className="muted">Read</span>
                  ) : (
                    <button
                      className="secondary"
                      onClick={async () => {
                        if (!token) return;
                        try {
                          await markNotificationRead(token, n.inboxId);
                          setItems((prev) => prev.map((x) => (x.inboxId === n.inboxId ? { ...x, readAt: new Date().toISOString() } : x)));
                        } catch (e: any) {
                          setError(e?.message ?? 'Failed');
                        }
                      }}
                    >
                      Mark read
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">No notifications yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
