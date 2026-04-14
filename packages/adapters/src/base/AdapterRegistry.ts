import type { ICountryAdapter } from './ICountryAdapter';

/**
 * Strict Architectural Registry (Singleton Wrapper).
 * Allows the orchestrator to dynamically inject geopolitical matrix dependencies into 
 * the Agent Execution pipeline exclusively mapping onto the user's localized ISO coordinates exactly physically.
 */
export class AdapterRegistry {
  private static instance: AdapterRegistry;
  
  // Hash map directly associating ISO strings natively onto instantiated class logics
  private readonly strategies: Map<string, ICountryAdapter> = new Map();

  private constructor() {}

  public static getInstance(): AdapterRegistry {
    if (!AdapterRegistry.instance) {
      AdapterRegistry.instance = new AdapterRegistry();
    }
    return AdapterRegistry.instance;
  }

  /**
   * Boots isolated physical geographic extensions natively injecting logic overloads.
   */
  public register(isoCode: string, adapter: ICountryAdapter): void {
    const code = isoCode.trim().toUpperCase();
    if (this.strategies.has(code)) {
       console.warn(`[Adapter Registry]: Geopolitical Strategy mappings for (${code}) are being unsafely overwritten dynamically.`);
    }
    this.strategies.set(code, adapter);
  }

  /**
   * Fetches isolated execution constraints universally routing physical dependencies.
   */
  public getAdapter(isoCode: string): ICountryAdapter {
    const code = isoCode.trim().toUpperCase();
    const adapter = this.strategies.get(code);

    if (!adapter) {
       // Throws physical execution constraints halting algorithms actively to explicitly prevent generic misalignments natively!
       throw new Error(`Fatal Geopolitical Alignment Fault: No localized execution adapter mapped structurally for ISO: (${code}).`);
    }

    return adapter;
  }
}
