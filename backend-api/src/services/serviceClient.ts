type ServiceInfo = {
  name: string;
  address: string;
  healthUrl?: string;
  description?: string;
  metadata?: Record<string, unknown>;
};

export async function resolveServiceAddress(
  gatewayUrl: string,
  targetService: string,
  registrationToken: string
): Promise<ServiceInfo> {
  const url = `${gatewayUrl.replace(/\/$/, '')}/services/${encodeURIComponent(targetService)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${registrationToken}`
    }
  });

  if (!res.ok) throw new Error(`resolveServiceAddress failed (${res.status}): ${await res.text()}`);

  const body = (await res.json()) as { service: ServiceInfo };
  return body.service;
}

export async function requestServiceToken(
  gatewayUrl: string,
  registrationToken: string,
  targetService: string,
  opts?: { method?: string; path?: string; ttlSeconds?: number }
): Promise<{ service: ServiceInfo; token: string }> {
  const url = `${gatewayUrl.replace(/\/$/, '')}/services/${encodeURIComponent(targetService)}/token`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${registrationToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ method: opts?.method, path: opts?.path, ttlSeconds: opts?.ttlSeconds })
  });

  if (!res.ok) throw new Error(`requestServiceToken failed (${res.status}): ${await res.text()}`);

  return (await res.json()) as { service: ServiceInfo; token: string };
}

export async function callServiceThroughGateway(
  gatewayUrl: string,
  registrationToken: string,
  targetService: string,
  opts: { method?: string; path?: string; headers?: Record<string, string>; body?: unknown }
): Promise<Response> {
  const service = await resolveServiceAddress(gatewayUrl, targetService, registrationToken);
  const { token } = await requestServiceToken(gatewayUrl, registrationToken, targetService, {
    method: opts.method,
    path: opts.path
  });

  const targetUrl = `${service.address.replace(/\/$/, '')}${opts.path ?? ''}`;

  const res = await fetch(targetUrl, {
    method: opts.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(opts.headers ?? {})
    },
    body: typeof opts.body === 'string' ? opts.body : opts.body ? JSON.stringify(opts.body) : undefined
  });

  return res;
}

export default { resolveServiceAddress, requestServiceToken, callServiceThroughGateway };
