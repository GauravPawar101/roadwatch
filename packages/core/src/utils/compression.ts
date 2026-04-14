/**
 * Pure interface stubs handling massive text/JSON array compressions for offline caching.
 */
export interface IDataCompressionUtils {
  /**
   * Compresses a heavily redundant JSON/text string into raw bytes.
   */
  compressText(data: string): Promise<Uint8Array>;

  /**
   * Decompresses stored byte sequences back into usable UI domain structures.
   */
  decompressText(compressedData: Uint8Array): Promise<string>;
}
