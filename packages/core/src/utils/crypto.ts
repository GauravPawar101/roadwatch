/**
 * Cryptographic utility interface definitions.
 * Physical injection of web-crypto or native bridging libraries happens at the provider layer.
 */
export interface ICryptoUtils {
  /**
   * Generates a standard SHA-256 hash string for payload/image comparison.
   */
  generateSHA256(payload: string): Promise<string>;

  /**
   * Constructs a Merkle Tree from an array of node hashes and returns the Merkle Root.
   * Useful for proving a subset of complaints existed within a specific daily system batch
   * prior to pushing an anchor onto an immutable public ledger.
   */
  calculateMerkleRoot(hashes: string[]): Promise<string>;
}
