// providers/fabric/FabricProvider.ts
// How your Node.js API gateway talks to the peer

import * as grpc from '@grpc/grpc-js'
import type { Gateway } from '@hyperledger/fabric-gateway'
import { connect, hash } from '@hyperledger/fabric-gateway'
import * as crypto from 'crypto'
import { promises as fs } from 'fs'

export class FabricProvider {
  private gateway: Gateway
  private client: grpc.Client
  private channelName = 'roadwatch-india'
  private chaincodeName = 'complaint-anchor'

  async initialize() {
    const env = this.getEnvConfig()
    const credentials = await this.loadCredentials(env)

    this.channelName = env.channel
    this.chaincodeName = env.chaincode

    const sslCredentials = grpc.credentials.createSsl(credentials.tlsCert)
    this.client = new grpc.Client(env.peerEndpoint, sslCredentials, {
      ...(env.peerHostAlias
        ? { 'grpc.ssl_target_name_override': env.peerHostAlias }
        : {})
    })

    // Connect gateway
    this.gateway = connect({
      client: this.client,
      identity: {
        mspId: env.mspId,
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
    const network = this.gateway.getNetwork(this.channelName)
    const contract = network.getContract(this.chaincodeName)

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
    const network = this.gateway.getNetwork(this.channelName)
    const contract = network.getContract(this.chaincodeName)

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
    const network = this.gateway.getNetwork(this.channelName)
    const contract = network.getContract(this.chaincodeName)

    await contract.submitTransaction(
      'AnchorEscalation',
      complaintId,
      fromAuthorityId,
      toAuthorityId,
      tier.toString(),
      Date.now().toString(),
    )
  }

  private requiredEnv(name: string) {
    const value = process.env[name]
    if (!value) throw new Error(`Missing required env var: ${name}`)
    return value
  }

  private getEnvConfig() {
    return {
      peerEndpoint:
        process.env.FABRIC_PEER_ENDPOINT ?? 'peer0.roadwatch.roadwatch.com:9051',
      peerHostAlias:
        process.env.FABRIC_PEER_HOST_ALIAS ?? 'peer0.roadwatch.roadwatch.com',
      mspId: process.env.FABRIC_MSP_ID ?? 'RoadWatchMSP',
      tlsCertPath: this.requiredEnv('FABRIC_TLS_CERT_PATH'),
      identityCertPath:
        process.env.FABRIC_IDENTITY_CERT_PATH ??
        process.env.FABRIC_CERT_PATH ??
        this.requiredEnv('FABRIC_IDENTITY_CERT_PATH'),
      identityKeyPath:
        process.env.FABRIC_IDENTITY_KEY_PATH ??
        process.env.FABRIC_KEY_PATH ??
        this.requiredEnv('FABRIC_IDENTITY_KEY_PATH'),
      channel: process.env.FABRIC_CHANNEL ?? 'roadwatch-india',
      chaincode: process.env.FABRIC_CHAINCODE ?? 'complaint-anchor'
    }
  }

  private async loadCredentials(env: ReturnType<FabricProvider['getEnvConfig']>) {
    const certPath = env.identityCertPath
    const keyPath = env.identityKeyPath
    const tlsPath = env.tlsCertPath

    return {
      certificate: await fs.readFile(certPath),
      privateKey:  await fs.readFile(keyPath),
      tlsCert:     await fs.readFile(tlsPath),
    }
  }
}