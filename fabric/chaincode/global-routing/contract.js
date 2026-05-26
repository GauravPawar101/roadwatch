const { Contract } = require('fabric-contract-api');

class GlobalRoutingContract extends Contract {
  async CreateRoutingRule(ctx, ruleJSON) {
    const msp = ctx.clientIdentity.getMSPID();
    if (msp !== 'NHAIMSP') throw new Error('CreateRoutingRule: unauthorized');
    const rule = JSON.parse(ruleJSON);
    if (!rule.ruleId) throw new Error('CreateRoutingRule: ruleId required');
    const key = ctx.stub.createCompositeKey('ROUTING', [rule.ruleId]);
    const exists = await ctx.stub.getState(key);
    if (exists && exists.length) throw new Error('CreateRoutingRule: rule already exists');
    const tsObj = await ctx.stub.getTxTimestamp();
    const ts = tsObj && tsObj.seconds ? Number(tsObj.seconds.low || tsObj.seconds) : Math.floor(Date.now() / 1000);
    rule.createdBy = msp; rule.updatedBy = msp; rule.chainCreatedAt = ts; rule.chainUpdatedAt = ts; rule.version = 1;
    await ctx.stub.putState(key, Buffer.from(JSON.stringify(rule)));
    await ctx.stub.setEvent('RoutingRuleCreated', Buffer.from(JSON.stringify(rule)));
  }

  async GetRoutingRule(ctx, regionCode, roadType) {
    if (!regionCode || !roadType) throw new Error('GetRoutingRule: missing args');
    const exactID = `${regionCode}_${roadType}`;
    const key = ctx.stub.createCompositeKey('ROUTING', [exactID]);
    const b = await ctx.stub.getState(key);
    if (b && b.length) return JSON.parse(b.toString());
    // try wildcard
    const parts = regionCode.split('-');
    const country = parts[0] || regionCode;
    const wild = `${country}-*_${roadType}`;
    const wk = ctx.stub.createCompositeKey('ROUTING', [wild]);
    const wb = await ctx.stub.getState(wk);
    if (wb && wb.length) return JSON.parse(wb.toString());
    throw new Error(`GetRoutingRule: rule not found for ${regionCode}/${roadType}`);
  }
}

module.exports = GlobalRoutingContract;
