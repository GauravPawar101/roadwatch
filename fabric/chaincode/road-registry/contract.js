const { Contract } = require('fabric-contract-api');

class RoadRegistryContract extends Contract {
  async CreateRoad(ctx, roadJSON) {
    const msp = ctx.clientIdentity.getMSPID();
    if (msp !== 'NHAIMSP' && msp !== 'RoadWatchMSP') throw new Error('CreateRoad: unauthorized');
    const road = JSON.parse(roadJSON);
    if (!road.roadId) throw new Error('CreateRoad: missing roadId');
    const key = ctx.stub.createCompositeKey('ROAD', [road.roadId]);
    const exists = await ctx.stub.getState(key);
    if (exists && exists.length) throw new Error('CreateRoad: road already exists');
    const tsObj = await ctx.stub.getTxTimestamp();
    const ts = tsObj && tsObj.seconds ? Number(tsObj.seconds.low || tsObj.seconds) : Math.floor(Date.now() / 1000);
    road.chainCreatedAt = ts; road.chainUpdatedAt = ts; road.updatedBy = msp; road.version = 1;
    await ctx.stub.putState(key, Buffer.from(JSON.stringify(road)));
    await ctx.stub.setEvent('RoadCreated', Buffer.from(JSON.stringify(road)));
  }

  async GetRoad(ctx, roadID) {
    if (!roadID) throw new Error('GetRoad: roadID required');
    const key = ctx.stub.createCompositeKey('ROAD', [roadID]);
    const b = await ctx.stub.getState(key);
    if (!b || b.length === 0) throw new Error('GetRoad: road not found');
    return JSON.parse(b.toString());
  }
}

module.exports = RoadRegistryContract;
