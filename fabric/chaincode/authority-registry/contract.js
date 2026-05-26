const { Contract } = require('fabric-contract-api');

class AuthorityRegistryContract extends Contract {
  async InitLedger(ctx) {
    // lightweight seed similar to Go
    const msp = ctx.clientIdentity.getMSPID();
    if (msp !== 'NHAIMSP') throw new Error('InitLedger: unauthorized');
    // seed omitted for brevity
  }

  async RegisterAuthority(ctx, authorityJSON) {
    const msp = ctx.clientIdentity.getMSPID();
    if (msp !== 'NHAIMSP') throw new Error('RegisterAuthority: unauthorized');
    const a = JSON.parse(authorityJSON);
    if (!a.authorityId) throw new Error('RegisterAuthority: missing authorityId');
    const key = ctx.stub.createCompositeKey('AUTHORITY', [a.authorityId]);
    const exists = await ctx.stub.getState(key);
    if (exists && exists.length) throw new Error('RegisterAuthority: authority already exists');
    a.registeredBy = msp;
    const tsObj = await ctx.stub.getTxTimestamp();
    const ts = tsObj && tsObj.seconds ? Number(tsObj.seconds.low || tsObj.seconds) : Math.floor(Date.now() / 1000);
    a.chainCreatedAt = ts; a.chainUpdatedAt = ts; a.version = 1;
    await ctx.stub.putState(key, Buffer.from(JSON.stringify(a)));
    await ctx.stub.setEvent('AuthorityRegistered', Buffer.from(JSON.stringify(a)));
  }

  async GetAuthority(ctx, authorityID) {
    if (!authorityID) throw new Error('GetAuthority: authorityID required');
    const key = ctx.stub.createCompositeKey('AUTHORITY', [authorityID]);
    const b = await ctx.stub.getState(key);
    if (!b || b.length === 0) throw new Error('GetAuthority: not found');
    return JSON.parse(b.toString());
  }
}

module.exports = AuthorityRegistryContract;
