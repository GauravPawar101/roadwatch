import type { Complaint, GeoLocation } from '../domain/Entities';

/**
 * The Central Nervous System Registry.
 * A rigorous Discriminated Union explicitly forbidding arbitrary unknown structural objects 
 * from polluting the physical in-memory pub-sub arrays dynamically.
 */
export type AppEvent =
  | { type: 'ROAD_SELECTED'; payload: { roadId: string; } }
  | { type: 'COMPLAINT_FILED'; payload: { complaint: Complaint; queuedOffline: boolean } }
  | { type: 'COMPLAINT_UPDATED'; payload: { complaintId: string; resolutionStatus: string; } }
  | { type: 'NETWORK_CHANGED'; payload: { isConnected: boolean; connectionClass?: string; } }
  | { type: 'SYNC_COMPLETED'; payload: { batchCountSynced: number; timestampUnix: number; } }
  | { type: 'LOCATION_UPDATED'; payload: { location: GeoLocation; accuracyMetres: number; } }
  | { type: 'AGENT_TOOL_CALLED'; payload: { toolName: string; logicStatus: string; } };
