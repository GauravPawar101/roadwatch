import type { AppEvent } from '@roadwatch/core/src/events/AppEvents';
import { EventBus } from '@roadwatch/core/src/events/EventBus';
import { useEffect, useRef } from 'react';

/**
 * Highly optimized React Hook wrapping the decoupled Event Bus physically.
 * Explicitly structurally enforces generic Type mappings traversing into the Presentation Layer cleanly.
 */
export function useAppEvent<T extends AppEvent['type']>(
  eventType: T,
  callback: (event: Extract<AppEvent, { type: T }>) => void
) {
  // Mathematical Optimization Requirement: 
  // Stashing the lambda explicitly inside a physical Mutable Ref intercepts massive re-render trees natively.
  // It stops React Native from destroying and recreating subscriptions whenever pure inline functions are thrown algorithmically.
  const callbackRef = useRef(callback);

  // Synchronously hooks the latest rendering state natively without triggering Bus drops
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    const eventBus = EventBus.getInstance();
    
    // Subscribes natively extracting exact Union subsets statically mapped natively!
    const unsubscribe = eventBus.on(eventType, (event) => {
       if (callbackRef.current) {
          callbackRef.current(event);
       }
    });

    // Teardown closure resolves RN component-unmount edge cases instantly preventing GC memory bloat dynamically.
    return () => {
       unsubscribe(); 
    };
  }, [eventType]); // Triggers strict mapping execution if the structural event string mutates explicitly
}
