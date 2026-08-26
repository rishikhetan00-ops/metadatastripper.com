import fs from 'fs';

/**
 * Generic MP4 / MOV Metadata Normalization & Extraction Layer
 */

// Category mapping helper
export function categorizeKey(keyName, originalKey = '') {
  const k = (keyName + ' ' + originalKey).toLowerCase();

  if (k.includes('location') || k.includes('gps') || k.includes('latitude') || k.includes('longitude') || k.includes('altitude') || k.includes('iso6709') || k.includes('xyz')) {
    return { category: 'Location', label: 'GPS / Location' };
  }
  if (k.includes('model') || k.includes('make') || k.includes('manufacturer') || k.includes('product') || k.includes('device') || k.includes('android.version') || k.includes('os_version')) {
    return { category: 'Device', label: keyName };
  }
  if (k.includes('lens') || k.includes('focal') || k.includes('aperture') || k.includes('camera') || k.includes('iso') || k.includes('shutter') || k.includes('exposure')) {
    return { category: 'Camera', label: keyName };
  }
  if (k.includes('date') || k.includes('time') || k.includes('timestamp') || k.includes('year')) {
    return { category: 'Date & Time', label: keyName };
  }
  if (k.includes('software') || k.includes('encoder') || k.includes('handler') || k.includes('app') || k.includes('tool')) {
    return { category: 'Software', label: keyName };
  }
  if (k.includes('title') || k.includes('artist') || k.includes('author') || k.includes('album') || k.includes('comment') || k.includes('copyright') || k.includes('genre')) {
    return { category: 'Descriptive', label: keyName };
  }

  return { category: 'Other', label: keyName };
}

/**
 * Robust ISOBMFF Atom Walker with Arbitrary QuickTime/Android Keys & hdlr Box Support
 */
export function parseIsobmffMetadataGeneric(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const metadataList = [];
  let hasLocation = false;

  const MAC_TO_UNIX_OFFSET = 2082844800;

  function readString(offset, length) {
    let str = '';
    for (let i = 0; i < length; i++) {
      if (offset + i >= view.byteLength) break;
      const charCode = view.getUint8(offset + i);
      if (charCode === 0) break;
      str += String.fromCharCode(charCode);
    }
    return str;
  }

  function readFourCC(offset) {
    let str = '';
    for (let i = 0; i < 4; i++) {
      if (offset + i >= view.byteLength) break;
      str += String.fromCharCode(view.getUint8(offset + i));
    }
    return str;
  }

  const quicktimeKeys = [];

  // Recursive Box Walker
  function walkBoxes(startOffset, endOffset, depth = 0) {
    let offset = startOffset;

    while (offset + 8 <= endOffset) {
      const boxSize32 = view.getUint32(offset);
      const boxType = readFourCC(offset + 4);

      let headerSize = 8;
      let boxSize = boxSize32;

      if (boxSize32 === 1) {
        if (offset + 16 > endOffset) break;
        const high = view.getUint32(offset + 8);
        const low = view.getUint32(offset + 12);
        boxSize = high * 4294967296 + low;
        headerSize = 16;
      } else if (boxSize32 === 0) {
        boxSize = endOffset - offset;
      }

      if (boxSize < headerSize || offset + boxSize > endOffset) break;

      const bodyOffset = offset + headerSize;
      const bodySize = boxSize - headerSize;

      // Walk container boxes
      if (['moov', 'udta', 'trak', 'mdia', 'minf', 'stbl'].includes(boxType)) {
        walkBoxes(bodyOffset, offset + boxSize, depth + 1);
      } else if (boxType === 'meta') {
        walkBoxes(bodyOffset + 4, offset + boxSize, depth + 1);
      } else if (boxType === 'ilst') {
        parseIlstBox(bodyOffset, offset + boxSize);
      } else if (boxType === 'keys') {
        parseKeysBox(bodyOffset, offset + boxSize);
      } else if (boxType === 'mvhd') {
        parseMvhdBox(bodyOffset, bodySize);
      } else if (boxType === 'tkhd') {
        parseTkhdBox(bodyOffset, bodySize);
      } else if (boxType === 'hdlr') {
        parseHdlrBox(bodyOffset, bodySize);
      } else if (boxType === 'location' || boxType === 'LOC' || boxType === 'xyz ' || boxType === '©xyz') {
        hasLocation = true;
        parseLocationBox(bodyOffset, bodySize);
      }

      offset += boxSize;
    }
  }

  // Parse hdlr box (Track Handler Name e.g. "SoundHandler", "VideoHandler")
  function parseHdlrBox(offset, size) {
    if (size < 24) return;
    const componentSubtype = readFourCC(offset + 8); // 'vide', 'soun', 'hint'
    const handlerName = readString(offset + 24, size - 24).trim();
    if (handlerName && handlerName !== 'VideoHandler' && handlerName !== 'SoundHandler') {
      const keyName = componentSubtype === 'vide' ? 'Video Handler' : 'Audio Handler';
      addMetadataItem({
        category: 'Software',
        name: keyName,
        key: `hdlr_${componentSubtype}`,
        value: handlerName,
        source: 'hdlr atom',
        originalKey: `hdlr.${componentSubtype}`,
        removable: true,
        status: 'removable'
      });
    }
  }

  // Parse mvhd box
  function parseMvhdBox(offset, size) {
    if (size < 12) return;
    const version = view.getUint8(offset);
    let creationTimeSec = 0;

    if (version === 1) {
      if (size < 28) return;
      const createHigh = view.getUint32(offset + 4);
      const createLow = view.getUint32(offset + 8);
      creationTimeSec = (createHigh * 4294967296 + createLow) - MAC_TO_UNIX_OFFSET;
    } else {
      const createSec = view.getUint32(offset + 4);
      creationTimeSec = createSec > 0 ? createSec - MAC_TO_UNIX_OFFSET : 0;
    }

    if (creationTimeSec > 0 && creationTimeSec < 2524608000) {
      const dateStr = new Date(creationTimeSec * 1000).toISOString();
      addMetadataItem({
        category: 'Date & Time',
        name: 'Creation Time',
        key: 'creationDate',
        value: dateStr,
        source: 'mvhd atom',
        originalKey: 'mvhd.creation_time',
        removable: true,
        status: 'removable'
      });
    }
  }

  // Parse tkhd box
  function parseTkhdBox(offset, size) {
    if (size < 12) return;
    const version = view.getUint8(offset);
    let creationTimeSec = 0;

    if (version === 1) {
      if (size < 24) return;
      const createHigh = view.getUint32(offset + 4);
      const createLow = view.getUint32(offset + 8);
      creationTimeSec = (createHigh * 4294967296 + createLow) - MAC_TO_UNIX_OFFSET;
    } else {
      const createSec = view.getUint32(offset + 4);
      creationTimeSec = createSec > 0 ? createSec - MAC_TO_UNIX_OFFSET : 0;
    }

    if (creationTimeSec > 0 && creationTimeSec < 2524608000) {
      const dateStr = new Date(creationTimeSec * 1000).toISOString();
      addMetadataItem({
        category: 'Date & Time',
        name: 'Track Creation Time',
        key: 'trackCreationDate',
        value: dateStr,
        source: 'tkhd atom',
        originalKey: 'tkhd.creation_time',
        removable: true,
        status: 'removable'
      });
    }
  }

  // Parse Location box
  function parseLocationBox(offset, size) {
    hasLocation = true;
    addMetadataItem({
      category: 'Location',
      name: 'GPS Location Data',
      key: 'location',
      value: 'Location Data Detected',
      source: 'udta.location',
      originalKey: 'location',
      removable: true,
      status: 'removable'
    });
  }

  // Parse Keys box
  function parseKeysBox(offset, endOffset) {
    if (offset + 8 > endOffset) return;
    const entryCount = view.getUint32(offset + 4);
    let ptr = offset + 8;

    for (let i = 1; i <= entryCount && ptr + 8 <= endOffset; i++) {
      const keySize = view.getUint32(ptr);
      if (keySize > 8 && ptr + keySize <= endOffset) {
        const keyName = readString(ptr + 8, keySize - 8);
        quicktimeKeys[i] = keyName;
      }
      ptr += keySize;
    }
  }

  // Parse ilst box with Generic Arbitrary Namespace Keys (OPPO com.oplus.*, Android com.android.*, Apple com.apple.*, Google, Samsung, etc.)
  function parseIlstBox(startOffset, endOffset) {
    let ptr = startOffset;

    while (ptr + 8 <= endOffset) {
      const itemSize = view.getUint32(ptr);
      if (itemSize < 8 || ptr + itemSize > endOffset) break;

      const itemTypeNum = view.getUint32(ptr + 4);
      const fourCC = readFourCC(ptr + 4);
      const itemBodyOffset = ptr + 8;
      const itemBodyEnd = ptr + itemSize;

      let dataVal = null;
      let dPtr = itemBodyOffset;

      while (dPtr + 8 <= itemBodyEnd) {
        const dSize = view.getUint32(dPtr);
        const dType = readFourCC(dPtr + 4);
        if (dType === 'data' && dSize >= 16 && dPtr + dSize <= itemBodyEnd) {
          const typeIndicator = view.getUint32(dPtr + 8);
          const valLen = dSize - 16;
          if (typeIndicator === 1 || typeIndicator === 0) {
            dataVal = readString(dPtr + 16, valLen);
          } else if (typeIndicator === 21) {
            dataVal = String(view.getUint16(dPtr + 16));
          }
          break;
        }
        if (dSize <= 0) break;
        dPtr += dSize;
      }

      if (dataVal && dataVal.trim()) {
        let rawKey = fourCC;
        let displayName = fourCC;

        if (quicktimeKeys[itemTypeNum]) {
          rawKey = quicktimeKeys[itemTypeNum];
          // Format arbitrary keys (e.g. com.oplus.product.model -> Product Model, com.oplus.camera.lens -> Camera Lens)
          const parts = rawKey.split('.');
          const lastTwo = parts.slice(-2).join(' ');
          displayName = lastTwo.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        } else {
          switch (fourCC) {
            case '©nam': displayName = 'Title'; break;
            case '©ART': displayName = 'Artist'; break;
            case '©alb': displayName = 'Album'; break;
            case '©cmt': displayName = 'Comment'; break;
            case '©gen': displayName = 'Genre'; break;
            case '©cpy': displayName = 'Copyright'; break;
            case '©too': displayName = 'Encoder'; break;
            case '©day': displayName = 'Creation Time'; break;
            case '©xyz': displayName = 'GPS Location'; hasLocation = true; break;
          }
        }

        const catInfo = categorizeKey(displayName, rawKey);

        addMetadataItem({
          category: catInfo.category,
          name: catInfo.label,
          key: rawKey,
          value: dataVal.trim(),
          source: 'ilst atom',
          originalKey: rawKey,
          removable: true,
          status: 'removable'
        });
      }

      ptr += itemSize;
    }
  }

  function addMetadataItem(item) {
    if (!metadataList.some(m => m.key === item.key)) {
      metadataList.push(item);
    }
  }

  // Execute recursive box walker
  try {
    walkBoxes(0, view.byteLength);
  } catch (e) {
    console.error('Box walker error:', e);
  }

  // Latin1 string sweep for unindexed ISO6709 location, OPPO/Android com.oplus.* keys, and camera metadata
  try {
    const fullDecoder = new TextDecoder('latin1');
    const rawLatinStr = fullDecoder.decode(new Uint8Array(arrayBuffer));

    // ISO6709 Location Pattern
    const rawGpsMatch = rawLatinStr.match(/([+-]\d{2}\.\d{4,8})([+-]\d{3}\.\d{4,8})\/?/);
    if (rawGpsMatch && !metadataList.some(m => m.key === 'location')) {
      hasLocation = true;
      addMetadataItem({
        category: 'Location',
        name: 'GPS Location Data',
        key: 'location',
        value: 'Location Data Detected',
        source: 'ISO6709 pattern',
        originalKey: 'location.ISO6709',
        removable: true,
        status: 'removable'
      });
    }

    // Generic sweep for vendor namespace key-value strings e.g. com.oplus.*, com.android.*, com.samsung.*, com.google.*
    const vendorMatches = rawLatinStr.matchAll(/(com\.[a-z0-9_.]+=?[\w\d.\s:-]{2,50})/gi);
    for (const match of vendorMatches) {
      const kv = match[0];
      const parts = kv.split(/=|\x00/);
      if (parts.length >= 2) {
        const vKey = parts[0].trim();
        const vVal = parts[1].trim();
        if (vKey.length > 5 && vVal.length > 1) {
          const catInfo = categorizeKey(vKey, vKey);
          addMetadataItem({
            category: catInfo.category,
            name: catInfo.label,
            key: vKey,
            value: vVal,
            source: 'vendor string sweep',
            originalKey: vKey,
            removable: true,
            status: 'removable'
          });
        }
      }
    }
  } catch (e) {}

  return {
    success: true,
    metadataList,
    totalCount: metadataList.length,
    hasMetadata: metadataList.length > 0,
    hasLocation
  };
}
