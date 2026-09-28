const { Contract } = require('fabric-contract-api');

const MerkleRootLength = 64;

const AUTHORIZED_MSPS = ['NHAIMSP', 'RoadWatchMSP'];

/**
 * Authorised MSPs, i.e. the orgs allowed to write anchor state.
 */
function assertAnchorWriter(ctx, fn) {
  const msp = ctx.clientIdentity.getMSPID();
  if (!AUTHORIZED_MSPS.includes(msp)) {
    throw new Error(`${fn}: unauthorized MSP: ${msp}`);
  }
  return msp;
}

/**
 * Ledger timestamp in seconds, falling back to local time only if the
 * proposal carries no timestamp (which a correct Fabric network always does).
 */
async function ledgerSeconds(ctx) {
  const tsObj = await ctx.stub.getTxTimestamp();
  const s = tsObj && tsObj.seconds;
  if (s === undefined || s === null) return Math.floor(Date.now() / 1000);
  if (typeof s.toNumber === 'function') return s.toNumber();
  if (typeof s === 'number') return s;
  return Number(s.low ?? 0) + Number(s.high ?? 0) * 2 ** 32;
}

/**
 * Composite key for a complaint record. GetComplaintHistory reads history for
 * this exact key, so both must agree or history comes back empty.
 */
function complaintKey(ctx, complaintId) {
  return ctx.stub.createCompositeKey('COMPLAINT', [complaintId]);
}

/**
 * Idempotency: a Kafka event redelivered after a rebalance must not write
 * twice. Returns false when this event was already recorded.
 */
async function claimEvent(ctx, eventId) {
  if (!eventId) return true;
  const key = ctx.stub.createCompositeKey('EVENT', [eventId]);
  const existing = await ctx.stub.getState(key);
  if (existing && existing.length > 0) return false;
  await ctx.stub.putState(key, Buffer.from('1'));
  return true;
}

/**
 * Statuses are validated by shape, not against a fixed list. There are ten
 * in active use (FILED, IN_PROGRESS, ESCALATED, RESOLVED, RESOLUTION_SUBMITTED,
 * CITIZEN_CONFIRMED, CITIZEN_DISPUTED, SLA_BREACHED, DISMISSED, REJECTED) and
 * the set is still growing; a hardcoded enum here would reject a legitimate
 * status and silently break anchoring for it, which is the failure this
 * contract is being fixed for.
 */
function assertStatusShape(newStatus) {
  if (typeof newStatus !== 'string' || !/^[A-Z][A-Z0-9_]{1,63}$/.test(newStatus)) {
    throw new Error(`invalid status value: ${newStatus}`);
  }
  return newStatus;
}

async function readComplaint(ctx, complaintId, fn) {
  const key = complaintKey(ctx, complaintId);
  const bytes = await ctx.stub.getState(key);
  if (!bytes || bytes.length === 0) {
    throw new Error(`${fn}: complaint not found on ledger: ${complaintId}`);
  }
  return JSON.parse(bytes.toString());
}

class ComplaintAnchorContract extends Contract {
  async SubmitMerkleRoot(ctx, merkleRoot, regionCode, batchSize) {
    const clientMSP = ctx.clientIdentity.getMSPID();
    if (clientMSP !== 'NHAIMSP' && clientMSP !== 'RoadWatchMSP') {
      throw new Error(`SubmitMerkleRoot: unauthorized MSP: ${clientMSP}`);
    }
    if (!merkleRoot || merkleRoot.length !== MerkleRootLength) {
      throw new Error(`SubmitMerkleRoot: invalid merkleRoot`);
    }
    if (!regionCode) throw new Error('SubmitMerkleRoot: regionCode required');
    if (!Number.isInteger(Number(batchSize)) || batchSize < 1) throw new Error('SubmitMerkleRoot: invalid batchSize');

    const key = ctx.stub.createCompositeKey('ANCHOR', [merkleRoot]);
    const existing = await ctx.stub.getState(key);
    if (existing && existing.length > 0) return;

    const tsObj = await ctx.stub.getTxTimestamp();
    const ts = tsObj && tsObj.seconds ? Number(tsObj.seconds.low || tsObj.seconds) : Math.floor(Date.now() / 1000);

    const record = {
      anchorId: 'ANCHOR_' + merkleRoot.slice(0, 16),
      merkleRoot,
      batchSize: Number(batchSize),
      regionCode,
      submittedBy: clientMSP,
      txId: ctx.stub.getTxID(),
      timestamp: ts,
    };
    await ctx.stub.putState(key, Buffer.from(JSON.stringify(record)));
    await ctx.stub.setEvent('MerkleRootAnchored', Buffer.from(JSON.stringify(record)));
  }

  async VerifyMerkleRoot(ctx, merkleRoot) {
    if (!merkleRoot || merkleRoot.length !== MerkleRootLength) throw new Error('VerifyMerkleRoot: invalid merkleRoot');
    const key = ctx.stub.createCompositeKey('ANCHOR', [merkleRoot]);
    const b = await ctx.stub.getState(key);
    if (!b || b.length === 0) throw new Error('VerifyMerkleRoot: anchor not found');
    return JSON.parse(b.toString());
  }

  async AnchorEscalation(ctx, complaintID, fromAuthorityID, toAuthorityID, tier, daysOpen) {
    const msp = ctx.clientIdentity.getMSPID();
    if (msp !== 'RoadWatchMSP') throw new Error(`AnchorEscalation: only RoadWatchMSP can perform this action, got: ${msp}`);
    if (!complaintID) throw new Error('AnchorEscalation: complaintID required');
    if (!fromAuthorityID || !toAuthorityID) throw new Error('AnchorEscalation: authority IDs required');
    if (fromAuthorityID === toAuthorityID) throw new Error('AnchorEscalation: invalid authority routing');
    tier = Number(tier);
    daysOpen = Number(daysOpen);
    if (tier < 1 || tier > 5) throw new Error('AnchorEscalation: invalid tier');
    if (daysOpen < 0 || daysOpen > 3650) throw new Error('AnchorEscalation: invalid daysOpen');

    const tsObj = await ctx.stub.getTxTimestamp();
    const ts = tsObj && tsObj.seconds ? Number(tsObj.seconds.low || tsObj.seconds) : Math.floor(Date.now() / 1000);
    const stampStr = String(ts);
    const key = ctx.stub.createCompositeKey('ESCALATION', [complaintID, stampStr]);
    const existing = await ctx.stub.getState(key);
    if (existing && existing.length > 0) throw new Error(`AnchorEscalation: escalation already exists: ${complaintID}`);

    const rec = {
      anchorId: 'ESC_' + complaintID + '_' + String(tier),
      complaintId: complaintID,
      fromAuthorityId: fromAuthorityID,
      toAuthorityId: toAuthorityID,
      tier,
      daysOpen,
      txId: ctx.stub.getTxID(),
      anchoredBy: msp,
      timestamp: ts,
    };
    await ctx.stub.putState(key, Buffer.from(JSON.stringify(rec)));
    await ctx.stub.setEvent('EscalationAnchored', Buffer.from(JSON.stringify(rec)));
  }

  async AnchorResolution(ctx, complaintID, resolvedBy, repairCID, captureHash) {
    const msp = ctx.clientIdentity.getMSPID();
    if (msp !== 'NHAIMSP' && msp !== 'RoadWatchMSP') throw new Error(`AnchorResolution: unauthorized MSP: ${msp}`);
    if (!complaintID || !resolvedBy || !repairCID || !captureHash) throw new Error('AnchorResolution: missing fields');
    if (!(captureHash.length === MerkleRootLength)) throw new Error('AnchorResolution: invalid captureHash');

    const key = ctx.stub.createCompositeKey('RESOLUTION', [complaintID]);
    const existing = await ctx.stub.getState(key);
    if (existing && existing.length > 0) throw new Error(`AnchorResolution: complaint already resolved: ${complaintID}`);

    const tsObj = await ctx.stub.getTxTimestamp();
    const ts = tsObj && tsObj.seconds ? Number(tsObj.seconds.low || tsObj.seconds) : Math.floor(Date.now() / 1000);

    const rec = {
      anchorId: 'RES_' + complaintID,
      complaintId: complaintID,
      resolvedBy,
      resolvedByMSP: msp,
      repairCID,
      captureHash,
      txId: ctx.stub.getTxID(),
      timestamp: ts,
    };
    await ctx.stub.putState(key, Buffer.from(JSON.stringify(rec)));
    await ctx.stub.setEvent('ComplaintResolved', Buffer.from(JSON.stringify(rec)));
  }

  /**
   * Create or update a complaint submission on the ledger.
   *
   * Called per event by the anchor consumer. A redelivered or replayed event
   * is a no-op, so a Kafka at-least-once redelivery cannot inflate the report
   * count.
   *
   * citizenId, location and initialIPFSCid are accepted for interface
   * compatibility but are deliberately NOT written to the world state. This
   * network has no 'citizenPIICollection' private-data collection configured,
   * so a putPrivateData call would abort the transaction and take the whole
   * anchor flush with it, and writing citizen identity to a shared ledger is
   * the wrong trade anyway. The accountability record is what needs to be
   * tamper-evident; the citizen's identity stays in Postgres. If the
   * collection is ever created, PII belongs in it, not in the world state.
   */
  async UpsertComplaintSubmission(
    ctx,
    id,
    citizenId,
    roadId,
    location,
    initialIPFSCid,
    authorityOrg,
    detailsHash,
    eventId,
    merged,
    reportCount
  ) {
    assertAnchorWriter(ctx, 'UpsertComplaintSubmission');
    if (!id) throw new Error('UpsertComplaintSubmission: complaint id required');
    if (!roadId) throw new Error('UpsertComplaintSubmission: roadId required');

    if (!(await claimEvent(ctx, eventId))) return;

    const ts = await ledgerSeconds(ctx);
    const key = complaintKey(ctx, id);
    const existing = await ctx.stub.getState(key);

    if (existing && existing.length > 0) {
      // Merge path: a repeat report at the same location bumps the count.
      const complaint = JSON.parse(existing.toString());
      complaint.ReportCount = Math.max(1, Number(reportCount) || (complaint.ReportCount || 0) + 1);
      complaint.UpdatedAt = ts;
      await ctx.stub.putState(key, Buffer.from(JSON.stringify(complaint)));
      await ctx.stub.setEvent('ComplaintSubmissionUpdated', Buffer.from(JSON.stringify(complaint)));
      return;
    }

    const complaint = {
      ID: id,
      RoadID: roadId,
      DetailsHash: detailsHash || '',
      ReportCount: Math.max(1, Number(reportCount) || 1),
      Status: 'FILED',
      AuthorityOrg: authorityOrg || '',
      Merged: merged === '1',
      CreatedAt: ts,
      UpdatedAt: ts,
    };

    await ctx.stub.putState(key, Buffer.from(JSON.stringify(complaint)));
    await ctx.stub.setEvent('ComplaintSubmitted', Buffer.from(JSON.stringify(complaint)));
  }

  /**
   * Record a status transition. The acting employee is written to the chaincode
   * event only, never to the world state, so the ledger holds the transition
   * and not who was on the account for it.
   */
  async UpdateComplaintStatus(ctx, complaintId, newStatus, officialEmployeeId, eventIdempotencyKey) {
    const msp = assertAnchorWriter(ctx, 'UpdateComplaintStatus');
    if (!complaintId) throw new Error('UpdateComplaintStatus: complaintId required');
    assertStatusShape(newStatus);

    if (!(await claimEvent(ctx, eventIdempotencyKey))) return;

    const complaint = await readComplaint(ctx, complaintId, 'UpdateComplaintStatus');
    const fromStatus = complaint.Status || null;
    complaint.Status = newStatus;
    complaint.UpdatedAt = await ledgerSeconds(ctx);

    await ctx.stub.putState(complaintKey(ctx, complaintId), Buffer.from(JSON.stringify(complaint)));
    await ctx.stub.setEvent(
      'ComplaintStatusUpdated',
      Buffer.from(
        JSON.stringify({
          complaintId,
          fromStatus,
          toStatus: newStatus,
          officialEmployeeId: officialEmployeeId || 'system',
          updatedByMSP: msp,
          updatedAt: complaint.UpdatedAt,
        })
      )
    );
  }

  /**
   * Resolve a complaint. Kept distinct from the generic status update because
   * resolution is the accountability-bearing transition: it is what clears an
   * SLA clock and what a contractor's report card counts.
   */
  async ResolveComplaint(ctx, complaintId, resolutionIPFSCid, officialEmployeeId) {
    const msp = assertAnchorWriter(ctx, 'ResolveComplaint');
    if (!complaintId) throw new Error('ResolveComplaint: complaintId required');

    const complaint = await readComplaint(ctx, complaintId, 'ResolveComplaint');
    complaint.Status = 'RESOLVED';
    complaint.ResolutionIPFSCid = resolutionIPFSCid || '';
    complaint.UpdatedAt = await ledgerSeconds(ctx);

    await ctx.stub.putState(complaintKey(ctx, complaintId), Buffer.from(JSON.stringify(complaint)));
    await ctx.stub.setEvent(
      'ComplaintResolved',
      Buffer.from(
        JSON.stringify({
          complaintId,
          resolvedBy: officialEmployeeId || 'system',
          resolvedByMSP: msp,
          resolutionIPFSCid: resolutionIPFSCid || '',
          resolvedAt: complaint.UpdatedAt,
        })
      )
    );
  }

  /**
   * Full write history for a complaint, as {txId, timestamp, isDelete, value}.
   */
  async GetComplaintHistory(ctx, complaintId) {
    if (!complaintId) throw new Error('GetComplaintHistory: complaintId required');

    const iterator = await ctx.stub.getHistoryForKey(complaintKey(ctx, complaintId));
    const history = [];
    while (true) {
      const res = await iterator.next();
      if (res.value && res.value.value && res.value.value.length) {
        let value = null;
        try {
          value = JSON.parse(res.value.value.toString());
        } catch (err) {
          value = res.value.value.toString();
        }
        history.push({
          txId: res.value.txId,
          timestamp: res.value.timestamp,
          isDelete: res.value.isDelete,
          value,
        });
      }
      if (res.done) {
        await iterator.close();
        break;
      }
    }
    return history;
  }

  async GetEscalationHistory(ctx, complaintID) {
    if (!complaintID) throw new Error('GetEscalationHistory: complaintID required');
    // Use CouchDB Mango rich query to fetch escalation records for the complaint
    // Requires the peer(s) for this chaincode to be configured with CouchDB state database.
    const query = {
      selector: {
        complaintId: complaintID,
      },
      sort: [{ timestamp: 'asc' }]
    };
    const it = await ctx.stub.getQueryResult(JSON.stringify(query));
    const results = [];
    while (true) {
      const res = await it.next();
      if (res.value && res.value.value && res.value.value.toString()) {
        const v = JSON.parse(res.value.value.toString('utf8'));
        results.push(v);
      }
      if (res.done) break;
    }
    return results;
  }

  async InitLedger(ctx) {
    const msp = ctx.clientIdentity.getMSPID();
    if (msp !== 'NHAIMSP' && msp !== 'RoadWatchMSP') throw new Error(`InitLedger: unauthorized MSP: ${msp}`);
    // Basic seed similar to Go implementation
    const tsObj = await ctx.stub.getTxTimestamp();
    const ts = tsObj && tsObj.seconds ? Number(tsObj.seconds.low || tsObj.seconds) : Math.floor(Date.now() / 1000);

    const seedMerkleRoot = 'a'.repeat(64);
    const anchorKey = ctx.stub.createCompositeKey('ANCHOR', [seedMerkleRoot]);
    const existing = await ctx.stub.getState(anchorKey);
    if (!existing || existing.length === 0) {
      const rec = {
        anchorId: 'ANCHOR_' + seedMerkleRoot.slice(0, 16),
        merkleRoot: seedMerkleRoot,
        batchSize: 3,
        regionCode: 'IN-DL',
        submittedBy: msp,
        txId: ctx.stub.getTxID(),
        timestamp: ts,
      };
      await ctx.stub.putState(anchorKey, Buffer.from(JSON.stringify(rec)));
    }
    // seed escalation and resolution similarly omitted for brevity
  }
}

module.exports = ComplaintAnchorContract;
