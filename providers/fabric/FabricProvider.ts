// providers/fabric/FabricProvider.ts
// How your Node.js API gateway talks to the peer

import { connect, hash } from '@hyperledger/fabric-gateway'
import * as grpc from '@grpc/grpc-js'
import { promises as fs } from 'fs'
import * as crypto from 'crypto'

export class FabricProvider {
  private gateway: Gateway
  private client: grpc.Client

  async initialize() {
    // Load RoadWatch org credentials
    const credentials = await this.loadCredentials()

    // gRPC connection to peer
    this.client = new grpc.Client(
      'peer0.roadwatch.roadwatch.com:9051',
      grpc.credentials.createSsl(credentials.tlsCert),
    )

    // Connect gateway
    this.gateway = connect({
      client: this.client,
      identity: {
        mspId: 'RoadWatchMSP',
        credentials: credentials.certificate,
      },
      signer: async (digest: Uint8Array) => {
        // Sign with RoadWatch private key
        // This is the "delegated signing" — API gateway holds the key
        return crypto.sign('sha256', digest, credentials.privateKey)
      },
      hash: hash.sha256,
    })
  }

  async submitMerkleRoot(
    merkleRoot: string,
    batchSize: number,
    regionCode: string,
  ): Promise<string> {
    const network = this.gateway.getNetwork('roadwatch-india')
    const contract = network.getContract('complaint-anchor')

    // submitTransaction — writes to ledger (requires endorsement)
    const result = await contract.submitTransaction(
      'SubmitMerkleRoot',
      merkleRoot,
      batchSize.toString(),
      regionCode,
      Date.now().toString(),
    )

    return Buffer.from(result).toString()
  }

  async verifyMerkleRoot(merkleRoot: string): Promise<boolean> {
    const network = this.gateway.getNetwork('roadwatch-india')
    const contract = network.getContract('complaint-anchor')

    // evaluateTransaction — reads from ledger (no endorsement needed)
    try {
      await contract.evaluateTransaction('VerifyMerkleRoot', merkleRoot)
      return true
    } catch {
      return false
    }
  }

  async anchorEscalation(
    complaintId: string,
    fromAuthorityId: string,
    toAuthorityId: string,
    tier: number,
  ): Promise<void> {
    const network = this.gateway.getNetwork('roadwatch-india')
    const contract = network.getContract('complaint-anchor')

    await contract.submitTransaction(
      'AnchorEscalation',
      complaintId,
      fromAuthorityId,
      toAuthorityId,
      tier.toString(),
      Date.now().toString(),
    )
  }

  private async loadCredentials() {
    const certPath = process.env.FABRIC_CERT_PATH!
    const keyPath  = process.env.FABRIC_KEY_PATH!
    const tlsPath  = process.env.FABRIC_TLS_CERT_PATH!

    return {
      certificate: await fs.readFile(certPath),
      privateKey:  await fs.readFile(keyPath),
      tlsCert:     await fs.readFile(tlsPath),
    }
  }
}