export type SessionNetworkStatus = 'none' | '2g' | '3g' | '4g' | '5g' | 'wifi';

/**
 * Mirrors the session-context `user.networkStatus` contract.
 * Keep values stable because they may be stored/serialized.
 */
export enum NetworkState {
  NONE = 'none',
  CELL_2G = '2g',
  CELL_3G = '3g',
  CELL_4G = '4g',
  CELL_5G = '5g',
  WIFI = 'wifi'
}

export function networkStateFromSessionStatus(status: SessionNetworkStatus): NetworkState {
  switch (status) {
    case 'none':
      return NetworkState.NONE;
    case '2g':
      return NetworkState.CELL_2G;
    case '3g':
      return NetworkState.CELL_3G;
    case '4g':
      return NetworkState.CELL_4G;
    case '5g':
      return NetworkState.CELL_5G;
    case 'wifi':
      return NetworkState.WIFI;
  }
}

export interface MediaAsset {
  id: string;
  sizeBytes: number;
  format: string; // 'webp', 'jpg', 'mp4'
}

export interface ComplaintPayload {
  id: string;
  textData: string; // Protobuf or JSON string representation
  images: MediaAsset[];
  videos: MediaAsset[];
}

export enum ActionDestination {
  EXECUTE_IMMEDIATELY = 'EXECUTE_IMMEDIATELY',
  QUEUE_OUTBOX = 'QUEUE_OUTBOX'
}

export interface NetworkActionQueue {
  textAction: ActionDestination;
  imageActions: Array<{ id: string; action: ActionDestination }>;
  videoActions: Array<{ id: string; action: ActionDestination }>;
  uiMessage: string;
}

export class NetworkDegradationManager {
  /**
   * Processes a data payload against the current Indian network capability
   * to determine real-time task orchestration versus outbox queuing.
   */
  public processPayload(payload: ComplaintPayload, networkState: NetworkState): NetworkActionQueue {
    const queue: NetworkActionQueue = {
      textAction: ActionDestination.QUEUE_OUTBOX,
      imageActions: [],
      videoActions: [],
      uiMessage: ''
    };

    switch (networkState) {
      case NetworkState.NONE:
        // Everything must wait in the SQLite/LevelDB Outbox.
        queue.textAction = ActionDestination.QUEUE_OUTBOX;
        payload.images.forEach(img => queue.imageActions.push({ id: img.id, action: ActionDestination.QUEUE_OUTBOX }));
        payload.videos.forEach(vid => queue.videoActions.push({ id: vid.id, action: ActionDestination.QUEUE_OUTBOX }));
        queue.uiMessage =
          "You're offline. I saved it on your device and it will sync automatically when you're back online. Nothing will be lost.";
        break;

      case NetworkState.CELL_2G:
      case NetworkState.CELL_3G:
        // Lightweight protocol allowed. Texts/Protobufs go through immediately.
        queue.textAction = ActionDestination.EXECUTE_IMMEDIATELY;
        
        // 2G/3G allows compressed WebP uploads. Large RAWs/JPEGs get deferred.
        payload.images.forEach(img => {
          if (img.format.toLowerCase() === 'webp' || img.sizeBytes < 500000) { 
            queue.imageActions.push({ id: img.id, action: ActionDestination.EXECUTE_IMMEDIATELY });
          } else {
            queue.imageActions.push({ id: img.id, action: ActionDestination.QUEUE_OUTBOX });
          }
        });

        // Videos are bandwidth-prohibitive on 2G/3G. Queue them.
        payload.videos.forEach(vid => queue.videoActions.push({ id: vid.id, action: ActionDestination.QUEUE_OUTBOX }));

        {
          const label = networkState === NetworkState.CELL_2G ? '2G' : '3G';
          const anyDeferred =
            queue.imageActions.some(a => a.action === ActionDestination.QUEUE_OUTBOX) ||
            queue.videoActions.some(a => a.action === ActionDestination.QUEUE_OUTBOX);

          queue.uiMessage = anyDeferred
            ? `Limited connection (${label}). Your complaint is filed — larger media will upload automatically when you have a stronger signal (4G/WiFi).`
            : `Limited connection (${label}). Complaint submitted.`;
        }
        break;

      case NetworkState.CELL_4G:
      case NetworkState.CELL_5G:
      case NetworkState.WIFI:
        // Unlimited capabilities. Push immediately to Cloudflare R2 / IPFS.
        queue.textAction = ActionDestination.EXECUTE_IMMEDIATELY;
        payload.images.forEach(img => queue.imageActions.push({ id: img.id, action: ActionDestination.EXECUTE_IMMEDIATELY }));
        payload.videos.forEach(vid => queue.videoActions.push({ id: vid.id, action: ActionDestination.EXECUTE_IMMEDIATELY }));
        
        queue.uiMessage = "Complaint submitted. High-definition media uploaded successfully.";
        break;
    }

    return queue;
  }
}
