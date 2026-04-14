import type { RoadWatchConfig } from '@roadwatch/config/src/DIContainer';
import { DependencyContext } from '@roadwatch/config/src/DIContainer';
import { useContext } from 'react';

/**
 * Master Dependency Resolution Extractor logically.
 * Pure strongly-typed abstraction allowing any nested View/Component to magnetically pull Core Engine instances mathematically.
 * 
 * Example Usage natively inside arbitrary UI nodes:
 * const { ai, routing, orchestrator } = useDependencies(); 
 */
export function useDependencies(): RoadWatchConfig {
  const context = useContext(DependencyContext);

  if (!context) {
    // Explicit hard block stopping structural invalidations proactively!
    throw new Error('Fatal React Context Execution Isolation: useDependencies implicitly invoked outside of the physical <DependencyProvider> bounds.');
  }

  return context;
}
