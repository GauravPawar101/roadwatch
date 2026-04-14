import { buildRoadWatchAgentPreamble } from '../system/roadwatch-agent';
import { PromptTemplate } from '../types';

export interface RepairScheduleInput {
  openComplaints: any[];
  budget: any;
  roads: any[];
  teamCapacity: number | null;
  weatherNote: string | null;
  adapter: any;
}

export interface RepairItem {
  roadId: string;
  complaintIds: string[];
  priority: number;
  reason: string;
  estimatedCost: number;
  suggestedDate: string;
  assignTo: string;
}

export interface RepairScheduleOutput {
  schedule: RepairItem[];
  totalEstimatedCost: number;
  budgetAdequacy: string;
  warnings: string[];
  unscheduled: string[];
}

export const repairSchedulePrompt: PromptTemplate<RepairScheduleInput, RepairScheduleOutput> = {
  id: 'repair-schedule-v1',
  version: '1.0.0',
  role: 'authority',
  network: 'both',
  model: 'any',
  maxTokens: 1024,
  temperature: 0.2,
  build: (input) => `${buildRoadWatchAgentPreamble({ persona: 'Authority', networkState: 'unknown' })}\nGenerate a repair schedule for an authority based ONLY on the provided open complaints, roads, and budget.\nOpen complaints (provided): ${JSON.stringify(input.openComplaints)}\nBudget (provided): ${JSON.stringify(input.budget)}\nRoads (provided): ${JSON.stringify(input.roads)}\nTeam capacity: ${input.teamCapacity}\nWeather note: ${input.weatherNote}\nAdapter (provided): ${JSON.stringify(input.adapter)}\n\nRespond in JSON: { schedule, totalEstimatedCost, budgetAdequacy, warnings, unscheduled }`,
  parse: (raw) => { try { return { ok: true, value: JSON.parse(raw) }; } catch (e) { return { ok: false, error: { message: 'Parse error' } }; } },
  validate: (output) => ({ valid: Array.isArray(output.schedule), errors: [] })
};
