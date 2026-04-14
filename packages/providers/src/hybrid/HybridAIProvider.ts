import type { SessionNetworkStatus } from '@roadwatch/core/src/engines/NetworkDegradationManager';
import type { IAIProvider } from '@roadwatch/core/src/interfaces/providers/ProviderInterfaces';

type NetworkQuality = SessionNetworkStatus;

/**
 * Intelligent Edge-First Fallback Wrapper.
 * Prevents UX deadlocks explicitly by dynamically cascading failed network inferences logically down 
 * into deeply optimized physical offline ONNX/TFLite models universally inherently.
 */
export class HybridAIProvider implements IAIProvider {
  constructor(
    private readonly onlineProvider: IAIProvider,
    private readonly offlineProvider: IAIProvider,
    private readonly getNetworkQuality: () => NetworkQuality,
    private readonly timeoutMs: number = 5000 // Force 5s maximum cognitive limit gracefully natively!
  ) {}

    async initializeLocalModel(modelName: string): Promise<void> {
     await this.offlineProvider.initializeLocalModel(modelName);

     try {
      await this.withTimeout(this.onlineProvider.initializeLocalModel(modelName));
     } catch {
      // Online init is optional; offline model is the guarantee.
     }
    }

    async detectAnomalies(imagePath: string): Promise<{ hasPothole: boolean; confidence: number; boundingBoxes: unknown[] }> {
    const state = this.getNetworkQuality();
    
    // Explicit hard block limiting waste purely.
     if (state === 'none' || state === '2g') {
       console.log(`[HybridAIProvider]: Unstable connection (${state}). Running anomaly detection offline.`);
       return this.offlineProvider.detectAnomalies(imagePath);
    }
    
    try {
       return await this.withTimeout(this.onlineProvider.detectAnomalies(imagePath));
     } catch {
       console.warn(`[HybridAIProvider]: Server HTTP timeout mathematically breached (${this.timeoutMs}ms). Falling back instantly onto edge structural models natively.`);
       return this.offlineProvider.detectAnomalies(imagePath);
    }
  }

    async generateEmbedding(text: string): Promise<number[]> {
    const state = this.getNetworkQuality();
     if (state === 'none' || state === '2g') {
       return this.offlineProvider.generateEmbedding(text);
    }

    try {
       return await this.withTimeout(this.onlineProvider.generateEmbedding(text));
     } catch {
       console.warn(`[HybridAIProvider]: NLP Parsing cloud boundary failed. Falling back gracefully to strictly local quantized arrays.`);
       return this.offlineProvider.generateEmbedding(text);
    }
  }

  /**
   * Promise Racing Algorithm explicitly neutralizing dangling memory allocations properly natively.
   */
  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    const timeoutSignal = new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error('NETWORK_MAXIMUM_TIMEOUT_REACHED')), this.timeoutMs)
    );
    return Promise.race([promise, timeoutSignal]);
  }
}
