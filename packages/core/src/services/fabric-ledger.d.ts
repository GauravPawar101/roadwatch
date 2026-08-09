type ComplaintLedgerInput = {
    complaintId: string;
    citizenId: string;
    roadId: string;
    location: Record<string, unknown>;
    initialIPFSCid: string;
    authorityOrg: string;
    detailsHash?: string;
    merged?: boolean;
    reportCount?: number;
    eventIdempotencyKey?: string;
};
type ComplaintHistoryEntry = {
    txId: string;
    timestamp: unknown;
    isDelete: boolean;
    value: unknown;
};
declare class FabricLedgerService {
    private gateway;
    private contract;
    private initPromise;
    private ensureConnected;
    private connect;
    createComplaint(input: ComplaintLedgerInput): Promise<string>;
    updateComplaintStatus(complaintId: string, newStatus: string, officialEmployeeId: string, eventIdempotencyKey?: string): Promise<string>;
    resolveComplaint(complaintId: string, resolutionIPFSCid: string, officialEmployeeId: string): Promise<string>;
    getComplaintHistory(complaintId: string): Promise<ComplaintHistoryEntry[]>;
    /**
     * Submit a Merkle root anchoring a batch of complaints to the ledger.
     * Returns both the transaction ID and the proposal transaction ID so callers
     * can build merkle proof records before the tx is committed.
     */
    submitMerkleRoot(merkleRoot: string, regionCode: string, batchSize: number): Promise<{
        txId: string;
        proposalTxId: string;
    }>;
}
export declare const fabricLedgerService: FabricLedgerService;
export {};
//# sourceMappingURL=fabric-ledger.d.ts.map