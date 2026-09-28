/**
 * Rewrites `sslmode=require` in a Postgres connection string to the mode that
 * actually means "encrypt, do not verify".
 *
 * This is a live failure, not a theoretical one. Since pg-connection-string
 * 2.7, `require`, `prefer` and `verify-ca` are all treated as aliases for
 * `verify-full`, so a URL written the way every provider documents it —
 * `?sslmode=require` — makes the client verify the certificate chain. Managed
 * providers present a certificate that verification rejects: Aiven and RDS use
 * a private CA that is not in the system trust store, and Supabase's `sslmode`
 * is documented against libpq rather than against node-postgres. The
 * connection then fails with `self-signed certificate in certificate chain`.
 *
 * Measured against Aiven PostgreSQL 18.6: `?sslmode=require` fails to connect,
 * while the same URL with `sslmode=no-verify` connects over TLSv1.3 and reads
 * normally.
 *
 * `no-verify` is node-postgres' own spelling of libpq's `require`: encrypt, and
 * do not check who is on the other end. That is the intent whenever the
 * application also passes `ssl: { rejectUnauthorized: false }`, which it does
 * for every managed endpoint.
 *
 * An explicit `verify-full` is left alone. That is a deliberate request to
 * check the chain, and quietly downgrading it would remove the only protection
 * the operator asked for — including the case where a provider CA has been
 * configured properly and verification should succeed.
 *
 * Only the mode is rewritten. Every other parameter, including a CA path, is
 * passed through untouched.
 */
export function normaliseSslMode(connectionString: string, sslRequested: boolean): string {
  if (!sslRequested) return connectionString;
  if (!/[?&]sslmode=(require|prefer|verify-ca)([&]|$)/i.test(connectionString)) {
    return connectionString;
  }
  return connectionString.replace(
    /([?&]sslmode=)(require|prefer|verify-ca)(?=[&]|$)/i,
    '$1no-verify',
  );
}
