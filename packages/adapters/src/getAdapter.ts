import type { ICountryAdapter } from './base/ICountryAdapter.js';
import { IndiaAdapter } from './india/IndiaAdapter.js';

/**
 * Returns the country adapter configured via the COUNTRY_ADAPTER env var.
 * Defaults to IndiaAdapter when the variable is absent or unrecognised.
 *
 * Add new adapters here as the platform expands to other countries.
 */
function createAdapter(): ICountryAdapter {
  const country = (process.env.COUNTRY_ADAPTER ?? 'india').trim().toLowerCase();
  switch (country) {
    case 'india':
    default:
      return new IndiaAdapter();
  }
}

// Module-level singleton — one adapter instance per process.
export const countryAdapter: ICountryAdapter = createAdapter();
