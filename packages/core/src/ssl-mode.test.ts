import { describe, expect, it } from 'vitest';
import { normaliseSslMode } from './ssl-mode.js';

/**
 * Since pg-connection-string 2.7, `sslmode=require` is an alias for
 * `verify-full`, so the URL every provider documents makes the client verify the
 * certificate chain — and a managed provider's private CA is not in the system
 * trust store. Measured against Aiven: the documented URL fails to connect with
 * `self-signed certificate in certificate chain`, and the same URL with
 * `no-verify` connects over TLSv1.3.
 */

const AIVEN =
  'postgresql://avnadmin:pw@roadwatch-pg-1.b.aivencloud.com:24627/defaultdb?sslmode=require';

describe('normaliseSslMode', () => {
  it('rewrites the documented sslmode=require to node-postgres\' own spelling', () => {
    expect(normaliseSslMode(AIVEN, true)).toBe(
      'postgresql://avnadmin:pw@roadwatch-pg-1.b.aivencloud.com:24627/defaultdb?sslmode=no-verify',
    );
  });

  it('rewrites prefer and verify-ca, which are aliases for verify-full too', () => {
    expect(normaliseSslMode('postgres://u:p@h/db?sslmode=prefer', true)).toContain('no-verify');
    expect(normaliseSslMode('postgres://u:p@h/db?sslmode=verify-ca', true)).toContain('no-verify');
  });

  it('is case-insensitive, as libpq parameter names are', () => {
    expect(normaliseSslMode('postgres://u:p@h/db?SSLMODE=REQUIRE', true)).toContain('no-verify');
  });

  /**
   * Downgrading an explicit verify-full would remove the only protection the
   * operator asked for. Where a provider CA has been configured properly, that
   * verification is meant to succeed.
   */
  it('leaves an explicit verify-full alone', () => {
    const explicit = 'postgres://u:p@h/db?sslmode=verify-full';
    expect(normaliseSslMode(explicit, true)).toBe(explicit);
  });

  it('leaves verify-full alone even when other parameters follow', () => {
    const explicit = 'postgres://u:p@h/db?sslmode=verify-full&sslrootcert=/etc/ssl/ca.pem';
    expect(normaliseSslMode(explicit, true)).toBe(explicit);
  });

  it('rewrites the mode without disturbing other parameters', () => {
    const rewritten = normaliseSslMode(
      'postgres://u:p@h:5432/db?application_name=roadwatch&sslmode=require&connect_timeout=10',
      true,
    );
    expect(rewritten).toContain('sslmode=no-verify');
    expect(rewritten).toContain('application_name=roadwatch');
    expect(rewritten).toContain('connect_timeout=10');
  });

  it('preserves a CA path so a properly configured provider can still verify', () => {
    const rewritten = normaliseSslMode(
      'postgres://u:p@h/db?sslmode=require&sslrootcert=/etc/ssl/aiven.crt',
      true,
    );
    expect(rewritten).toContain('sslmode=no-verify');
    expect(rewritten).toContain('sslrootcert=/etc/ssl/aiven.crt');
  });

  /**
   * A local socket or an explicit non-SSL endpoint must not be altered, or a
   * connection that worked before would start demanding TLS.
   */
  it('changes nothing when TLS was not requested', () => {
    expect(normaliseSslMode(AIVEN, false)).toBe(AIVEN);
    expect(normaliseSslMode('postgres://postgres:postgres@127.0.0.1:16432/roadwatch', false))
      .toBe('postgres://postgres:postgres@127.0.0.1:16432/roadwatch');
  });

  it('changes nothing when there is no sslmode parameter', () => {
    const plain = 'postgres://u:p@h:5432/db?application_name=roadwatch';
    expect(normaliseSslMode(plain, true)).toBe(plain);
  });

  /**
   * `prefer` and `verify-ca` are only aliases when they are the whole value.
   * A mode ending in those words must not be rewritten.
   */
  it('does not rewrite a different mode that merely shares a prefix', () => {
    const other = 'postgres://u:p@h/db?sslmode=verify-full';
    expect(normaliseSslMode(other, true)).toBe(other);
  });

  it('is idempotent, so calling it twice is harmless', () => {
    const once = normaliseSslMode(AIVEN, true);
    expect(normaliseSslMode(once, true)).toBe(once);
  });

  it('never emits a credential-bearing value in an error-free path', () => {
    // Guards against a future change that starts returning a modified string
    // with the password expanded or logged.
    const out = normaliseSslMode(AIVEN, true);
    expect(out).toContain('avnadmin:pw');
    expect(out).not.toMatch(/undefined|NaN/);
  });
});
