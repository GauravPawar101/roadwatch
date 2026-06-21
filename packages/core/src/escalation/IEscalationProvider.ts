import type { EscalationRecord } from './EscalationRecord.js';

export interface IEscalationProvider {
  anchorEscalation(record: EscalationRecord): Promise<string>; // returns fabricTxId
}

export interface INotificationProvider {
  sendToAuthority(authorityId: string, payload: unknown): Promise<void>;
  sendToCitizen(citizenId: string, payload: unknown): Promise<void>;
}

export interface ILocalStore {
  saveEscalationRecord(record: EscalationRecord): Promise<void>;
}
