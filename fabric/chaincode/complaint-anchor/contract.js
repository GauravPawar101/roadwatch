const { Contract } = require('fabric-contract-api');

const MerkleRootLength = 64;

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
