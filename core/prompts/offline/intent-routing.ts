import { buildRoadWatchAgentPreamble } from '../system/roadwatch-agent';
import { PromptTemplate } from '../types';

export interface IntentRoutingInput {
  userMessage: string;
}

export interface IntentRoutingOutput {
  intent:
    | 'FILE_COMPLAINT'
    | 'CHECK_STATUS'
    | 'WHO_IS_RESPONSIBLE'
    | 'BUDGET_QUERY'
    | 'ESCALATE'
    | 'ROAD_INFO_QUERY'
    | 'AUTHORITY_QUEUE'
    | 'VERIFY_PROOF'
    | 'UNKNOWN';
  confidence: number;
  canAnswerOffline: boolean;
  offlineFAQKey: string | null;
  requiresNetwork: string | null;
}

export const intentRoutingPrompt: PromptTemplate<IntentRoutingInput, IntentRoutingOutput> = {
  id: 'intent-routing-v2',
  version: '1.0.0',
  role: 'system',
  network: 'offline',
  model: 'mlkit',
  maxTokens: 64,
  temperature: 0.0,
  build: (input) =>
    `${buildRoadWatchAgentPreamble({ persona: 'System', networkState: 'offline' })}\n` +
    `Classify the user's message into exactly one intent:\n` +
    `- FILE_COMPLAINT, CHECK_STATUS, WHO_IS_RESPONSIBLE, BUDGET_QUERY, ESCALATE, ROAD_INFO_QUERY, AUTHORITY_QUEUE, VERIFY_PROOF, UNKNOWN\n\n` +
    `Then set offlineFAQKey (or null) for quick offline help:\n` +
    `- FILE_COMPLAINT -> how_file_complaint\n` +
    `- WHO_IS_RESPONSIBLE -> who_responsible_nh\n` +
    `- ESCALATE -> complaint_not_resolved\n` +
    `- VERIFY_PROOF -> what_is_blockchain_receipt\n` +
    `- BUDGET_QUERY -> budget_info\n\n` +
    `User message: ${input.userMessage}\n\n` +
    `Respond in JSON: { intent, confidence, canAnswerOffline, offlineFAQKey, requiresNetwork }`,
  parse: (raw) => { try { return { ok: true, value: JSON.parse(raw) }; } catch (e) { return { ok: false, error: { message: 'Parse error' } }; } },
  validate: (output) => ({ valid: typeof output.intent === 'string', errors: [] })
};
