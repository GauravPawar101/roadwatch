// Shared secret + endpoint resolution for the load tools.
//
// The gateway verifies access tokens with ACCESS_SECRET (falling back to
// JWT_SECRET). In apps/gateway-api/.env those two are DIFFERENT values, so a
// load tool that signs with JWT_SECRET produces tokens the gateway rejects and
// the run reports ~100% failures that look like an application problem.
//
// Resolution order mirrors the gateway's own getEnv():
//   ACCESS_SECRET -> JWT_SECRET
// then, if neither is in the environment, the local .env, then the in-cluster
// Secret, then a dev default.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(__dirname, '..', '..');

const DEV_DEFAULT = 'local_development_cryptographic_secret';

function unquote(value) {
  return value.trim().replace(/^["']|["']$/g, '');
}

/**
 * Read a key from apps/gateway-api/.env.
 *
 * That file is HYBRID: most entries use `KEY=value` (dotenv), but the three
 * signing secrets use `KEY:   "value"` (Kubernetes-Secret style). dotenv only
 * understands `=`, so a `KEY:` entry is silently ignored — which is why the
 * gateway actually runs on the built-in development default locally despite
 * 128-char secrets appearing in that file. Accept both separators here so the
 * load tools can sign with whatever the gateway will really use.
 */
function fromDotEnv(key) {
  const envPath = path.join(repoRoot, 'apps', 'gateway-api', '.env');
  if (!existsSync(envPath)) return undefined;
  const text = readFileSync(envPath, 'utf8');
  const match = text.match(new RegExp(`^\\s*${key}\\s*[=:]\\s*(.+?)\\s*$`, 'm'));
  return match ? unquote(match[1]) : undefined;
}

/** True when the key exists in .env but only in the colon form dotenv ignores. */
export function isColonFormOnly(key) {
  const envPath = path.join(repoRoot, 'apps', 'gateway-api', '.env');
  if (!existsSync(envPath)) return false;
  const text = readFileSync(envPath, 'utf8');
  return new RegExp(`^\\s*${key}\\s*:\\s*\\S`, 'm').test(text)
    && !new RegExp(`^\\s*${key}\\s*=`, 'm').test(text);
}

function fromClusterSecret(key) {
  const res = spawnSync(
    'kubectl',
    ['get', 'secret', 'app-secrets', '-n', 'roadwatch', '-o', `jsonpath={.data.${key}}`],
    { encoding: 'utf8' }
  );
  if (res.status === 0 && res.stdout?.trim()) {
    try {
      return Buffer.from(res.stdout.trim(), 'base64').toString('utf8');
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Resolve the secret the gateway will actually verify with.
 * @param {string} [cliSecret] explicit override from the command line
 */
export function resolveAccessSecret(cliSecret) {
  if (cliSecret) return cliSecret;

  if (process.env.ACCESS_SECRET?.trim()) return process.env.ACCESS_SECRET.trim();
  if (process.env.JWT_SECRET?.trim()) return process.env.JWT_SECRET.trim();

  return (
    fromDotEnv('ACCESS_SECRET') ??
    fromDotEnv('JWT_SECRET') ??
    fromClusterSecret('ACCESS_SECRET') ??
    fromClusterSecret('JWT_SECRET') ??
    DEV_DEFAULT
  );
}

/**
 * Where the gateway lives.
 *
 * The previous default was http://localhost:3000, which is the FRONTEND port,
 * not the API. In-cluster the gateway is a NodePort on 30100 (see
 * k8s/kind-config.yaml), locally it is 3100.
 */
export function resolveTargetUrl(cliUrl) {
  if (cliUrl) return cliUrl;
  if (process.env.TARGET_URL?.trim()) return process.env.TARGET_URL.trim();
  return 'http://127.0.0.1:3100';
}

export { DEV_DEFAULT };
