import { parseIsobmffMetadata } from '../src/utils/videoMetadataEngine.js';

function createMockOppoMp4Buffer() {
  const buffer = new ArrayBuffer(4096);
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);

  let offset = 0;

  // ftyp box (20 bytes)
  view.setUint32(offset, 20);
  u8.set([102, 116, 121, 112], offset + 4);
  u8.set([105, 115, 111, 109], offset + 8);
  offset += 20;

  // moov box
  const moovStart = offset;
  view.setUint32(offset, 0);
  u8.set([109, 111, 111, 118], offset + 4);
  offset += 8;

  // mvhd box
  view.setUint32(offset, 108);
  u8.set([109, 118, 104, 100], offset + 4);
  view.setUint32(offset + 12, 3774954800);
  view.setUint32(offset + 16, 3774954800);
  offset += 108;

  // udta box
  const udtaStart = offset;
  view.setUint32(offset, 0);
  u8.set([117, 100, 116, 97], offset + 4);
  offset += 8;

  // meta box inside udta
  const metaStart = offset;
  view.setUint32(offset, 0);
  u8.set([109, 101, 116, 97], offset + 4);
  view.setUint32(offset + 8, 0); // 4-byte FullBox header
  offset += 12;

  // keys box inside meta (defining 5 keys)
  const keysStart = offset;
  const keysList = [
    'com.oplus.product.model',
    'com.oplus.android.version',
    'com.oplus.lens.model',
    'com.oplus.lens.focal_length',
    'com.oplus.lens.max_aperture_value'
  ];

  view.setUint32(offset, 0);
  u8.set([107, 101, 121, 115], offset + 4);
  view.setUint32(offset + 8, 0); // FullBox flags
  view.setUint32(offset + 12, keysList.length); // Entry count
  offset += 16;

  for (let i = 0; i < keysList.length; i++) {
    const kStr = keysList[i];
    const kLen = 8 + kStr.length;
    view.setUint32(offset, kLen);
    u8.set([109, 100, 105, 97], offset + 4); // mdta namespace
    for (let j = 0; j < kStr.length; j++) {
      u8[offset + 8 + j] = kStr.charCodeAt(j);
    }
    offset += kLen;
  }
  view.setUint32(keysStart, offset - keysStart);

  // ilst box inside meta (providing values for the 5 keys)
  const ilstStart = offset;
  const valuesList = [
    'OPPO Find X9s',
    '16',
    'front_main',
    '21.0mm',
    'f/2.4'
  ];

  view.setUint32(offset, 0);
  u8.set([105, 108, 115, 116], offset + 4);
  offset += 8;

  for (let i = 0; i < valuesList.length; i++) {
    const itemStart = offset;
    const vStr = valuesList[i];
    view.setUint32(offset, 0);
    view.setUint32(offset + 4, i + 1); // 1-based index into keys
    offset += 8;

    const dataLen = 16 + vStr.length;
    view.setUint32(offset, dataLen);
    u8.set([100, 97, 116, 97], offset + 4);
    view.setUint32(offset + 8, 1);
    view.setUint32(offset + 12, 0);
    for (let j = 0; j < vStr.length; j++) {
      u8[offset + 16 + j] = vStr.charCodeAt(j);
    }
    offset += dataLen;
    view.setUint32(itemStart, offset - itemStart);
  }
  view.setUint32(ilstStart, offset - ilstStart);

  view.setUint32(metaStart, offset - metaStart);
  view.setUint32(udtaStart, offset - udtaStart);
  view.setUint32(moovStart, offset - moovStart);

  return buffer;
}

function runOppoTest() {
  const buffer = createMockOppoMp4Buffer();
  console.log(`Mock OPPO Find X9s MP4 Created (${buffer.byteLength} bytes)`);

  const results = parseIsobmffMetadata(buffer);
  console.log('--- SCANNER RESULTS FOR OPPO FIND X9S MP4 ---');
  console.log('Total Count:', results.totalCount);
  console.log('Metadata Items:', JSON.stringify(results.metadataList, null, 2));
}

runOppoTest();
