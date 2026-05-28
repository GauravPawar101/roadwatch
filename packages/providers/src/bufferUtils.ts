export function bufferToUint8Array(buf: Buffer): Uint8Array {
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
  return new Uint8Array(ab);
}
