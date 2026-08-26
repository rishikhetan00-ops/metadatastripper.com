import { parseIsobmffMetadata } from './test_mp4_parser.js';

function createMockMp4Buffer() {
  // Construct a binary MP4 buffer containing a moov atom, mvhd atom with creation date, and udta location
  const buffer = new ArrayBuffer(2048);
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);

  let offset = 0;

  // ftyp box (20 bytes)
  view.setUint32(offset, 20);
  u8.set([102, 116, 121, 112], offset + 4); // ftyp
  u8.set([105, 115, 111, 109], offset + 8); // isom
  offset += 20;

  // moov box (header)
  const moovStart = offset;
  view.setUint32(offset, 0); // Will update moov size later
  u8.set([109, 111, 111, 118], offset + 4); // moov
  offset += 8;

  // mvhd box (108 bytes) - Mac epoch timestamp for 2023-08-15 (1692110000 + 2082844800 = 3774954800)
  view.setUint32(offset, 108);
  u8.set([109, 118, 104, 100], offset + 4); // mvhd
  view.setUint8(offset + 8, 0); // version 0
  view.setUint32(offset + 12, 3774954800); // creation_time
  view.setUint32(offset + 16, 3774954800); // modification_time
  offset += 108;

  // udta box
  const udtaStart = offset;
  view.setUint32(offset, 0);
  u8.set([117, 100, 116, 97], offset + 4); // udta
  offset += 8;

  // location box inside udta
  const locStart = offset;
  const gpsStr = '+37.7749-122.4194/';
  view.setUint32(offset, 8 + gpsStr.length);
  u8.set([108, 111, 99, 97], offset + 4); // loca
  for (let i = 0; i < gpsStr.length; i++) {
    u8[offset + 8 + i] = gpsStr.charCodeAt(i);
  }
  offset += 8 + gpsStr.length;

  // Update sizes
  view.setUint32(udtaStart, offset - udtaStart);
  view.setUint32(moovStart, offset - moovStart);

  return buffer;
}

function runTest() {
  const buffer = createMockMp4Buffer();
  console.log(`Mock MP4 Buffer Created (${buffer.byteLength} bytes)`);

  const results = parseIsobmffMetadata(buffer);
  console.log('--- SCAN RESULTS ---');
  console.log('Success:', results.success);
  console.log('Total Count:', results.totalCount);
  console.log('Has Location:', results.hasLocation);
  console.log('Metadata Items:', JSON.stringify(results.metadataList, null, 2));
}

runTest();
