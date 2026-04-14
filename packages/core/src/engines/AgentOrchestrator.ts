import type { UserContext } from './AccessControl';
import { PermissionGatekeeper, UserRole } from './AccessControl';
import type { BoundingBox } from './ContextBuilder';
import { ContextBuilder } from './ContextBuilder';
import { IntentClassifier, RecognizedIntent } from './IntentClassifier';
import { NetworkDegradationManager, NetworkState } from './NetworkDegradationManager';

export class AgentOrchestrator {
  constructor(
    private readonly intentClassifier: IntentClassifier,
    private readonly contextBuilder: ContextBuilder,
    private readonly permissionGatekeeper: PermissionGatekeeper,
    private readonly networkManager: NetworkDegradationManager
  ) {}

  /**
   * The Master Entrypoint for the AI Brain.
   * Receives incoming messages and sequentially filters them through 
   * Local Intents -> Ambient Context -> RBAC Safety -> Network Degradation.
   */
  public async executeUserCommand(
    rawMessage: string, 
    user: UserContext, 
    currentNetworkState: NetworkState,
    locationBounds?: BoundingBox
  ): Promise<Record<string, unknown>> {
    
    console.log(`\\n=== [Orchestrator] Starting cycle for User: ${user.id} (${user.role}) ===`);

    // 1. INTENT CLASSIFICATION (NLP routing)
    const activeIntent = this.intentClassifier.classify(rawMessage);
    console.log(`[1. Intent]: NLP resolved action to '${activeIntent}'`);

    // 2. CONTEXT BUILDING (Database assembly)
    const contextPayload = await this.contextBuilder.buildContext(activeIntent, user.id, locationBounds);
    console.log(`[2. Context]: Resolved ${contextPayload.recentHistory.length} local history nodes and privileges.`);

    // 3. PERMISSION GATEKEEPER (RBAC)
    // Validate if the user is attempting an action they aren't authorized for in this zone.
    // For this generic orchestration simulation, we test if they can perform chain modifications if requested.
    if (activeIntent === RecognizedIntent.FILE_COMPLAINT && user.role !== UserRole.CITIZEN) {
      const allowed = this.permissionGatekeeper.canAssignInspector(user.role);
      if (!allowed) {
        throw new Error("RBAC Error: This internal role is not permitted to initiate field actions.");
      }
    }
    console.log(`[3. RBAC Gatekeeper]: Clear. User authorized for active workspace.`);


    // 4. LOCAL TOOL CALLS (Smart offline operations)
    let executionOutput;
    
    switch (activeIntent) {
      case RecognizedIntent.FILE_COMPLAINT:
        executionOutput = this.simulateToolCall('local_file_complaint', { text: rawMessage });
        break;
      case RecognizedIntent.WHO_IS_RESPONSIBLE:
        executionOutput = this.simulateToolCall('local_sqlite_query', { zone: user.zone_id });
        break;
      case RecognizedIntent.VERIFY_PROOF:
        executionOutput = this.simulateToolCall('local_verify_proof', { text: rawMessage });
        break;
      default:
        executionOutput = { localData: 'General conversation LLM fallback handled.' };
    }
    console.log(`[4. Local Tools]: Terminated with status => ${executionOutput.status}`);


    // 5. NETWORK DEGRADATION 
    // Instead of failing blindly, we run the execution output + media attachments through our degradation matrix.
    const networkActionQueue = this.networkManager.processPayload({
      id: `REQ-${Date.now()}`,
      textData: JSON.stringify(executionOutput),
      images: executionOutput.hasMedia ? [{ id: 'img1', format: 'jpg', sizeBytes: 1048576 }] : [],
      videos: []
    }, currentNetworkState);
    
    console.log(`[5. Network Matrix]: State=${currentNetworkState}. Text Instruction: ${networkActionQueue.textAction}`);


    // 6. SIDE-EFFECT HANDLER
    // Triggers local persistence and queues immutable anchoring based on the degradation manager's decisions.
    this.triggerSideEffects(activeIntent, networkActionQueue, user);

    console.log(`=== [Orchestrator] Cycle Complete ===\\n`);

    // Return the ultimate orchestrated response to the UI
    return {
      finalIntent: activeIntent,
      uiMessage: networkActionQueue.uiMessage,
      actionQueue: networkActionQueue
    };
  }

  /**
   * Mock utility simulating physical side-effects.
   */
  private triggerSideEffects(intent: RecognizedIntent, networkQueue: any, user: UserContext) {
    console.log(`[6. Side Effects]: Firing SQLite COMMIT for active session state.`);
    
    if (intent === RecognizedIntent.FILE_COMPLAINT) {
      if (this.permissionGatekeeper.canModifyChain(user.role)) {
        console.log(`[6. Side Effects]: Queuing high-privilege State Blockchain modification.`);
      } else {
        console.log(`[6. Side Effects]: Citizen/Low-Tier submission recorded in local Outbox.`);
      }
    }
  }

  /**
   * Mock utility simulating hitting native bindings purely from local memory.
   */
  private simulateToolCall(toolName: string, params: any) {
    if (toolName === 'local_mlkit_scan') {
      return { status: 'SUCCESS', hasMedia: true, confidence: 0.94 };
    }
    return { status: 'SUCCESS', hasMedia: false };
  }
}
