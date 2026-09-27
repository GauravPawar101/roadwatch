import {
  assertManagedEndpoints,
  describeEndpoints,
  describeManagedEndpointGaps,
  formatManagedEndpointGaps
} from '@roadwatch/core';

/**
 * Standard startup reporting for infrastructure endpoints.
 *
 * Every service resolves its endpoints through the same contract, so every
 * service should also *report* them the same way. The sequence is deliberate:
 *
 *   1. try the managed/cloud tier (the resolver has already done this);
 *   2. say so — name the components that will run on-device, and loudly flag
 *      any that look misconfigured;
 *   3. start on the resolved endpoints, managed or not.
 *
 * The flag matters because the fallback is silent by design: it is what lets a
 * developer run with no cloud account, and what lets a pod start when a Secret
 * failed to mount. Without a report, both look identical from the outside.
 *
 * With INFRA_REQUIRE_MANAGED=true a *misconfigured* managed endpoint refuses to
 * start instead. A component with nothing configured is still allowed, so a
 * fully local deployment keeps working.
 *
 * @param serviceName used as the log prefix, e.g. 'gateway-api'
 */
export function reportInfrastructure(serviceName: string, env: NodeJS.ProcessEnv = process.env): void {
  // Fail before any connection attempt, so the failure names the variable.
  assertManagedEndpoints(env);

  console.log(`[${serviceName}] Endpoints: ${describeEndpoints(env)}`);

  const gaps = describeManagedEndpointGaps(env);
  const broken = gaps.filter(g => g.problem);
  const onDevice = gaps.filter(g => !g.problem);

  if (onDevice.length > 0) {
    console.warn(`[${serviceName}] Infrastructure: ${formatManagedEndpointGaps(onDevice)}`);
  }
  if (broken.length > 0) {
    console.error(`[${serviceName}] Infrastructure: ${formatManagedEndpointGaps(broken)}`);
  }
}
