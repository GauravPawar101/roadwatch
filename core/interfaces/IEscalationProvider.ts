import { EscalationRecord } from '../domain/EscalationRecord';

export interface IEscalationProvider {
  anchorEscalation(record: EscalationRecord): Promise<string>; // returns fabricTxId
}

export interface INotificationProvider {
  sendToAuthority(authorityId: string, payload: any): Promise<void>;
  sendToCitizen(citizenId: string, payload: any): Promise<void>;
}

export interface ILocalStore {
  saveEscalationRecord(record: EscalationRecord): Promise<void>;
}
