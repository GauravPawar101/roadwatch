import type { IBlockchainStore } from '@roadwatch/core/src/interfaces/storage/StorageInterfaces';

export class MockFabricStore implements IBlockchainStore {
  private readonly anchors = new Map<string, { payloadHash: string; txId: string }>();

  async anchorComplaintHash(complaintId: string, payloadHash: string): Promise<string> {
    const txId = `TX-${complaintId}-${this.hashShort(payloadHash)}`;
    this.anchors.set(complaintId, { payloadHash, txId });
    return txId;
  }

  async verifyComplaintHash(complaintId: string, payloadHash: string): Promise<boolean> {
    const existing = this.anchors.get(complaintId);
    if (!existing) return false;
    return existing.payloadHash === payloadHash;
  }

  async getTransactionReceipt(transactionId: string): Promise<Record<string, unknown> | null> {
    for (const [complaintId, anchor] of this.anchors.entries()) {
      if (anchor.txId === transactionId) {
        return {
          transactionId,
          complaintId,
          anchored: true
        };
      }
    }
    return null;
  }

  getAnchoredHash(complaintId: string): string | null {
    return this.anchors.get(complaintId)?.payloadHash ?? null;
  }

  private hashShort(payloadHash: string): string {
    return payloadHash.slice(0, 8);
  }
}
