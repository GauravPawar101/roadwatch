const { Contract } = require('fabric-contract-api');

class BudgetRegistryContract extends Contract {
  async RecordSanction(ctx, sanctionJSON) {
    const msp = ctx.clientIdentity.getMSPID();
    if (msp !== 'NHAIMSP') throw new Error('RecordSanction: unauthorized');
    const s = JSON.parse(sanctionJSON);
    if (!s.sanctionId || !s.roadId) throw new Error('RecordSanction: missing fields');
    const key = ctx.stub.createCompositeKey('SANCTION', [s.roadId, s.sanctionId]);
    const exists = await ctx.stub.getState(key);
    if (exists && exists.length) throw new Error('RecordSanction: sanction already exists');
    const tsObj = await ctx.stub.getTxTimestamp();
    const ts = tsObj && tsObj.seconds ? Number(tsObj.seconds.low || tsObj.seconds) : Math.floor(Date.now() / 1000);
    s.sanctionedBy = msp; s.txId = ctx.stub.getTxID(); s.timestamp = ts;
    await ctx.stub.putState(key, Buffer.from(JSON.stringify(s)));
    await ctx.stub.setEvent('BudgetSanctioned', Buffer.from(JSON.stringify(s)));
  }

  async GetBudgetSummary(ctx, roadID) {
    if (!roadID) throw new Error('GetBudgetSummary: roadID required');
    const key = ctx.stub.createCompositeKey('BUDGETSUM', [roadID]);
    const b = await ctx.stub.getState(key);
    if (!b || b.length === 0) throw new Error('GetBudgetSummary: not found');
    return JSON.parse(b.toString());
  }
}

module.exports = BudgetRegistryContract;
