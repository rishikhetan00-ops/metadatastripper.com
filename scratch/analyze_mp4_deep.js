import fs from 'fs';

/**
 * Deep Inspection Tool for MP4 / MOV Binary Atoms, Metadata Keys, EXIF, and XMP
 */
export function deepInspectMp4(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const rawFoundAtoms = [];
  const detectedKeys = [];
  const textDecoder = new TextDecoder('latin1');
  const fullStr = textDecoder.decode(new Uint8Array(buffer));

  console.log(`=== DEEP MP4 BINARY INSPECTION (${buffer.length} bytes) ===`);

  // 1. Scan for all 4-byte atom types inside the file
  function readFourCC(offset) {
    let str = '';
    for (let i = 0; i < 4; i++) {
      if (offset + i >= view.byteLength) break;
      const b = view.getUint8(offset + i);
      if (b >= 32 && b <= 126) str += String.fromCharCode(b);
      else str += '.';
    }
    return str;
  }

  function walk(start, end, path = '') {
    let offset = start;
    while (offset + 8 <= end) {
      const size32 = view.getUint32(offset);
      const type = readFourCC(offset + 4);
      
      let headerSize = 8;
      let boxSize = size32;

      if (size32 === 1) {
        if (offset + 16 > end) break;
        const high = view.getUint32(offset + 8);
        const low = view.getUint32(offset + 12);
        boxSize = high * 4294967296 + low;
        headerSize = 16;
      } else if (size32 === 0) {
        boxSize = end - offset;
      }

      if (boxSize < headerSize || offset + boxSize > end) break;

      const currentPath = path ? `${path}.${type}` : type;
      rawFoundAtoms.push({ path: currentPath, offset, size: boxSize });

      const bodyOffset = offset + headerSize;
      const bodySize = boxSize - headerSize;

      if (['moov', 'udta', 'trak', 'mdia', 'minf', 'stbl', 'ilst'].includes(type)) {
        walk(bodyOffset, offset + boxSize, currentPath);
      } else if (type === 'meta') {
        // Meta box might be FullBox (4 byte ver/flags) or plain box
        const checkType = readFourCC(bodyOffset + 4);
        if (checkType === 'hdlr' || checkType === 'keys' || checkType === 'ilst') {
          walk(bodyOffset, offset + boxSize, currentPath);
        } else {
          walk(bodyOffset + 4, offset + boxSize, currentPath);
        }
      }

      offset += boxSize;
    }
  }

  try {
    walk(0, view.byteLength);
  } catch (e) {
    console.error('Walk error:', e);
  }

  console.log(`\n--- ATOM HIERARCHY (${rawFoundAtoms.length} atoms found) ---`);
  rawFoundAtoms.forEach(a => console.log(`- ${a.path} (size: ${a.size} bytes)`));

  // 2. Scan for QuickTime & Android Keys strings in binary text
  console.log('\n--- VENDOR KEY STRING PATTERN MATCHES ---');
  const matches = fullStr.matchAll(/(com\.[a-zA-Z0-9_.]+|©[a-zA-Z0-9]{3}|Android|OPPO|Samsung|iPhone|Camera|Lens|Focal|Aperture)/gi);
  const uniqueMatches = new Set();
  for (const m of matches) {
    uniqueMatches.add(m[0]);
  }
  uniqueMatches.forEach(m => console.log(`  Key Pattern: ${m}`));

  // 3. Scan for Embedded XMP or EXIF data
  console.log('\n--- XMP / EXIF BLOCKS ---');
  const xmpIdx = fullStr.indexOf('<x:xmpmeta');
  if (xmpIdx !== -1) {
    const xmpEnd = fullStr.indexOf('</x:xmpmeta>', xmpIdx);
    console.log(`XMP Meta Block Found at byte ${xmpIdx}:`);
    console.log(fullStr.substring(xmpIdx, xmpEnd !== -1 ? xmpEnd + 12 : xmpIdx + 500));
  } else {
    console.log('No <x:xmpmeta XML block found.');
  }

  return {
    rawFoundAtoms,
    fullStrLength: fullStr.length
  };
}

// If run directly with a file parameter
const fileArg = process.argv[2];
if (fileArg && fs.existsSync(fileArg)) {
  const buf = fs.readFileSync(fileArg);
  deepInspectMp4(buf);
}
