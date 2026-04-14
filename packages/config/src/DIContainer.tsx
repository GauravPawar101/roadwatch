import React, { createContext, useMemo } from 'react';

// Strictly typed explicit core boundaries imported gracefully.
import type { AgentOrchestrator } from '@roadwatch/core/src/engines/AgentOrchestrator';
import type { IAIProvider, IMapProvider, IRoutingProvider } from '@roadwatch/core/src/interfaces/providers/ProviderInterfaces';
import type { ILocalStore, IOutboxQueue } from '@roadwatch/core/src/interfaces/storage/StorageInterfaces';

/**
 * The Master Dependency Injection Blueprint natively mapped strictly.
 */
export interface RoadWatchConfig {
  ai: IAIProvider;
  map: IMapProvider;
  routing: IRoutingProvider;
  localStore: ILocalStore;
  outboxQueue: IOutboxQueue;
  orchestrator: AgentOrchestrator;
  
  // Future capabilities seamlessly attach mapping directly structurally here natively.
}

// Global arbitrary context array implicitly isolated directly.
export const DependencyContext = createContext<RoadWatchConfig | null>(null);

/**
 * Clean Architecture Root Wrapper explicitly managing execution arrays globally across React Native threads seamlessly!
 */
export const DependencyProvider: React.FC<{
  config: RoadWatchConfig;
  children: React.ReactNode;
}> = ({ config, children }) => {
  
  // Architectural Core Performance Hook: 
  // Prevents aggressive arbitrary React prop-drilling trees cascading complete structural destruction mathematically natively.
  // The context rigidly locks structural logic instances preventing millions of re-allocations on render sequences.
  const cachedConfig = useMemo(() => config, [config]);

  return (
    <DependencyContext.Provider value={cachedConfig}>
      {children}
    </DependencyContext.Provider>
  );
};
