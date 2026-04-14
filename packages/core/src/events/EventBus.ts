import type { AppEvent } from './AppEvents';

/**
 * Lightweight, purely typed Event Driven singleton bridge.
 * Physically eliminates nasty prop-drilling or circular dependency hell across structurally isolated
 * ViewModels, Offline Synchronizers, and Agent Orchestrator branches inherently.
 */
export class EventBus {
  private static instance: EventBus;
  
  // Backing memory array physically storing disjoint references mapped securely
  private readonly listeners: Map<string, Array<(event: any) => void>> = new Map();

  private constructor() {}

  /**
   * Standard Singleton acquisition preventing multiple split-brain memory pools dynamically.
   */
  public static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  /**
   * Broadcasts physical events ensuring strict type checking at the dispatch node dynamically.
   */
  public emit<T extends AppEvent>(event: T): void {
    const callbacks = this.listeners.get(event.type);
    if (!callbacks || callbacks.length === 0) return;

    // Executes iteration trapping arbitrary UI exceptions natively to prevent crashing the global bus loop.
    callbacks.forEach(cb => {
      try {
        cb(event);
      } catch (err) {
        console.error(`[EventBus Framework] UI Execution Fault intercepted logically on event: ${event.type}`, err);
      }
    });
  }

  /**
   * Safely mounts listeners dynamically extracting exact Union subsets statically natively via 'Extract'.
   * Returns a physical GC lambda destructor resolving nasty RN memory leaks instantaneously.
   */
  public on<T extends AppEvent['type']>(
    type: T, 
    callback: (event: Extract<AppEvent, { type: T }>) => void
  ): () => void {
    
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    
    const targetBranch = this.listeners.get(type)!;
    targetBranch.push(callback);

    // Strict Memory Teardown Closure (crucial for executing properly inside generic React useEffect boundaries).
    return () => {
      const activeListeners = this.listeners.get(type);
      if (activeListeners) {
         this.listeners.set(type, activeListeners.filter(cb => cb !== callback));
      }
    };
  }
}
