import type { GeoLocation } from '@roadwatch/core/src/domain/Entities';
import type { IRoutingProvider } from '@roadwatch/core/src/interfaces/providers/ProviderInterfaces';

/**
 * Intelligent B-Tree Mathematical Routing Fallback Array.
 * Allows systems to blindly call 'calculateRoute' knowing structurally it will mathematically resolve 
 * using Cloud Servers if stable, or fall completely back onto cached localized vector tiles internally.
 */
export class HybridRoutingProvider implements IRoutingProvider {
  constructor(
    private readonly onlineProvider: IRoutingProvider,
    private readonly offlineProvider: IRoutingProvider,
    private readonly isPhysicallyConnected: () => boolean,
    private readonly timeoutMs: number = 4000 // Routing usually fails harder in transit
  ) {}

  /**
   * Binds geospatial matrices routing physically across points securely via Cloud or offline Vector memory blocks.
   */
  async calculateRoute(start: GeoLocation, end: GeoLocation): Promise<any> {
    
    // Explicit execution gate logically overriding unpingable cloud streams natively.
    if (!this.isPhysicallyConnected()) {
       console.log(`[HybridRoutingProvider]: Executing route calculations securely against offline vectorized A* algorithms inherently.`);
       return this.offlineProvider.calculateRoute(start, end);
    }

    try {
       return await this.withTimeout(this.onlineProvider.calculateRoute(start, end));
    } catch (e) {
       console.warn(`[HybridRoutingProvider]: Cloud directions completely failed. Reversing logic into edge constraints securely.`);
       return this.offlineProvider.calculateRoute(start, end); // Triggers backup natively!
    }
  }

  /**
   * Standard Race Condition natively isolating hanging connections implicitly.
   */
  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    const timeoutSignal = new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error('ROUTING_TIMEOUT_EXCEEDED')), this.timeoutMs)
    );
    return Promise.race([promise, timeoutSignal]);
  }
}
