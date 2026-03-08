export interface ParsedPacket {
  c: number;
  cc: number;
  payload: Buffer;
}

/**
 * Parse a VLQ (variable-length quantity) encoded integer from a buffer at the given offset.
 * Each byte: bit 7 is the continuation flag, bits 0-6 carry data.
 * @returns A tuple of [decodedValue, numberOfBytesConsumed].
 */
export function parseVlqLength(data: Buffer, offset: number): [number, number] {
  let value = 0;
  let shift = 0;
  let bytesConsumed = 0;

  while (offset < data.length && shift <= 28) {
    const byte = data[offset];
    value |= (byte & 0x7f) << shift;
    offset++;
    bytesConsumed++;
    shift += 7;

    if ((byte & 0x80) === 0) {
      break;
    }
  }

  return [value, bytesConsumed];
}

/**
 * Parse all complete server-to-client packets from raw TCP data.
 * Each packet in the stream is: VLQ-encoded length prefix, followed by C (1 byte), CC (1 byte), and the remaining payload.
 * @returns An array of parsed packets. Incomplete trailing data is silently ignored.
 */
export function parseServerPackets(data: Buffer): ParsedPacket[] {
  const packets: ParsedPacket[] = [];
  let offset = 0;

  while (offset < data.length) {
    const [length, vlqSize] = parseVlqLength(data, offset);

    if (length < 2) {
      break;
    }

    const packetStart = offset + vlqSize;
    const packetEnd = packetStart + length;

    if (packetEnd > data.length) {
      break;
    }

    const c = data[packetStart];
    const cc = data[packetStart + 1];
    const payload = data.subarray(packetStart + 2, packetEnd);

    packets.push({ c, cc, payload });
    offset = packetEnd;
  }

  return packets;
}
