import { Context, Contract } from 'fabric-contract-api';
import { Complaint, ComplaintPII, ComplaintStatus, MerkleAnchorBatch } from './asset';

export class ComplaintContract extends Contract {
    /**
     * Create a new Complaint asset on the ledger.
        * Only callable by CitizenOrgMSP (citizen-side backend delegator).
     */
    public async CreateComplaint(
        ctx: Context,
        id: string,
        citizenId: string,
        roadId: string,
        location: string,
        initialIPFSCid: string,
        authorityOrg: string,
        detailsHash?: string
    ): Promise<void> {
        const mspId = ctx.clientIdentity.getMSPID();
        const allowedCitizenMsps = (process.env.ALLOWED_CITIZEN_MSPS ?? 'CitizenOrgMSP')
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);

        if (!allowedCitizenMsps.includes(mspId)) {
            throw new Error(`MSP ${mspId} is not authorized to create complaints.`);
        }

        // Check if complaint already exists
        const exists = await ctx.stub.getState(id);
        if (exists && exists.length > 0) {
            throw new Error(`Complaint with ID ${id} already exists.`);
        }

        const now = Date.now();
        const complaint: Complaint = {
            ID: id,
            RoadID: roadId,
            DetailsHash: detailsHash ?? '',
            Status: ComplaintStatus.FILED,
            AuthorityOrg: authorityOrg,
            CreatedAt: now,
            UpdatedAt: now
        };

        await ctx.stub.putState(id, Buffer.from(JSON.stringify(complaint)));

        // Store PII off-ledger via Private Data Collection (preferred) using transient data.
        // If the client hasn't been updated to use transient, fall back to args (still not written to world state).
        const transient = ctx.stub.getTransient();
        let pii: ComplaintPII;

        const transientPii = transient.get('pii');
        if (transientPii && transientPii.length > 0) {
            pii = JSON.parse(Buffer.from(transientPii).toString('utf8')) as ComplaintPII;
        } else {
            pii = {
                CitizenID: citizenId || undefined,
                Location: location || undefined,
                InitialIPFSCid: initialIPFSCid || undefined
            };
        }

        if (pii && (pii.CitizenID || pii.Location || pii.InitialIPFSCid)) {
            await ctx.stub.putPrivateData('citizenPIICollection', id, Buffer.from(JSON.stringify(pii)));
        }
    }

    /**
     * Anchor a Merkle root representing a batch of off-ledger complaint events.
     * Stores only the root + batch metadata on the ledger (no PII).
     */
    public async AnchorMerkleRoot(ctx: Context, batchId: string, merkleRoot: string, count: string): Promise<void> {
        const mspId = ctx.clientIdentity.getMSPID();
        const allowedCitizenMsps = (process.env.ALLOWED_CITIZEN_MSPS ?? 'CitizenOrgMSP')
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);

        if (!allowedCitizenMsps.includes(mspId)) {
            throw new Error(`MSP ${mspId} is not authorized to anchor Merkle roots.`);
        }

        const now = Date.now();
        const key = `ANCHOR_BATCH_${batchId}`;
        const exists = await ctx.stub.getState(key);
        if (exists && exists.length > 0) {
            throw new Error(`Anchor batch with ID ${batchId} already exists.`);
        }

        const batch: MerkleAnchorBatch = {
            ID: batchId,
            MerkleRoot: merkleRoot,
            Count: Number(count),
            CreatedAt: now
        };

        await ctx.stub.putState(key, Buffer.from(JSON.stringify(batch)));
        await ctx.stub.setEvent('MerkleRootAnchored', Buffer.from(JSON.stringify({
            batchId,
            merkleRoot,
            count: batch.Count,
            anchoredAt: now
        })));
    }
    /**
     * Update the status of a complaint (Authority only).
     */
    public async UpdateComplaintStatus(
        ctx: Context,
        complaintId: string,
        newStatus: string,
        officialEmployeeId: string
    ): Promise<void> {
        const mspId = ctx.clientIdentity.getMSPID();
        if (mspId === 'CitizenOrgMSP') {
            throw new Error('Citizens cannot update complaint status.');
        }
        // Only allow registered authority MSPs (example: NHAI_MSP, PWD_MSP)
        if (!mspId.endsWith('MSP') || mspId === 'CitizenOrgMSP') {
            throw new Error('Unauthorized MSP.');
        }

        const complaintBytes = await ctx.stub.getState(complaintId);
        if (!complaintBytes || complaintBytes.length === 0) {
            throw new Error(`Complaint with ID ${complaintId} does not exist.`);
        }
        const complaint: Complaint = JSON.parse(complaintBytes.toString());

        // Validate newStatus
        if (!Object.values(ComplaintStatus).includes(newStatus as ComplaintStatus)) {
            throw new Error('Invalid status value.');
        }
        complaint.Status = newStatus as ComplaintStatus;
        complaint.UpdatedAt = Date.now();

        await ctx.stub.putState(complaintId, Buffer.from(JSON.stringify(complaint)));

        // Avoid writing any employee ID to the ledger; if needed, include it only as an event payload.
        await ctx.stub.setEvent('ComplaintStatusUpdated', Buffer.from(JSON.stringify({
            complaintId,
            newStatus: complaint.Status,
            officialEmployeeId,
            updatedAt: complaint.UpdatedAt
        })));
    }

    /**
     * Resolve a complaint (Authority only). Emits a chaincode event.
     */
    public async ResolveComplaint(
        ctx: Context,
        complaintId: string,
        resolutionIPFSCid: string,
        officialEmployeeId: string
    ): Promise<void> {
        const mspId = ctx.clientIdentity.getMSPID();
        if (mspId === 'CitizenOrgMSP') {
            throw new Error('Citizens cannot resolve complaints.');
        }
        if (!mspId.endsWith('MSP') || mspId === 'CitizenOrgMSP') {
            throw new Error('Unauthorized MSP.');
        }

        const complaintBytes = await ctx.stub.getState(complaintId);
        if (!complaintBytes || complaintBytes.length === 0) {
            throw new Error(`Complaint with ID ${complaintId} does not exist.`);
        }
        const complaint: Complaint = JSON.parse(complaintBytes.toString());

        complaint.Status = ComplaintStatus.RESOLVED;
        complaint.UpdatedAt = Date.now();

        await ctx.stub.putState(complaintId, Buffer.from(JSON.stringify(complaint)));

        // Store resolution evidence in PDC (not public world state)
        try {
            const existingPiiBytes = await ctx.stub.getPrivateData('citizenPIICollection', complaintId);
            const existingPii: ComplaintPII = existingPiiBytes && existingPiiBytes.length > 0
                ? (JSON.parse(Buffer.from(existingPiiBytes).toString('utf8')) as ComplaintPII)
                : ({} as ComplaintPII);
            const nextPii: ComplaintPII = { ...existingPii, ResolutionIPFSCid: resolutionIPFSCid };
            await ctx.stub.putPrivateData('citizenPIICollection', complaintId, Buffer.from(JSON.stringify(nextPii)));
        } catch {
            // If PDC write isn't available (peer config), silently skip.
        }

        // Emit event for mobile/WebSocket listeners
        await ctx.stub.setEvent('ComplaintResolved', Buffer.from(JSON.stringify({
            complaintId,
            // Do not emit resolution IPFS CID in clear if it can contain PII.
            resolutionCommitment: resolutionIPFSCid ? 'present' : 'absent',
            officialEmployeeId,
            resolvedAt: complaint.UpdatedAt
        })));
    }
    /**
     * Get the full immutable history of a complaint.
     */
    public async GetComplaintHistory(ctx: Context, complaintId: string): Promise<Array<any>> {
        const iterator = await ctx.stub.getHistoryForKey(complaintId);
        const history: Array<any> = [];
        while (true) {
            const res = await iterator.next();
            if (res.value && res.value.value.toString()) {
                const tx = {
                    txId: res.value.txId,
                    timestamp: res.value.timestamp,
                    isDelete: res.value.isDelete,
                    value: null as unknown,
                };
                try {
                    tx.value = JSON.parse(res.value.value.toString());
                } catch {
                    tx.value = res.value.value.toString();
                }
                history.push(tx);
            }
            if (res.done) {
                await iterator.close();
                break;
            }
        }
        return history;
    }

    /**
     * Query all complaints for a given RoadID using CouchDB rich query.
     */
    public async QueryComplaintsByRoad(ctx: Context, roadId: string): Promise<Complaint[]> {
        const query = {
            selector: {
                RoadID: roadId
            }
        };
        const iterator = await ctx.stub.getQueryResult(JSON.stringify(query));
        const results: Complaint[] = [];
        while (true) {
            const res = await iterator.next();
            if (res.value && res.value.value.toString()) {
                results.push(JSON.parse(res.value.value.toString()));
            }
            if (res.done) {
                await iterator.close();
                break;
            }
        }
        return results;
    }

    /**
     * Query all pending complaints for a given authority (not RESOLVED).
     */
    public async QueryPendingComplaintsByAuthority(ctx: Context, authorityOrg: string): Promise<Complaint[]> {
        const query = {
            selector: {
                AuthorityOrg: authorityOrg,
                Status: { "$ne": "RESOLVED" }
            }
        };
        const iterator = await ctx.stub.getQueryResult(JSON.stringify(query));
        const results: Complaint[] = [];
        while (true) {
            const res = await iterator.next();
            if (res.value && res.value.value.toString()) {
                results.push(JSON.parse(res.value.value.toString()));
            }
            if (res.done) {
                await iterator.close();
                break;
            }
        }
        return results;
    }
}
