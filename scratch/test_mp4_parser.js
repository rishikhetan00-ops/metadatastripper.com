import fs from 'fs';

/**
 * ISOBMFF / QuickTime Atom Walker & Metadata Extractor
 */
export function parseIsobmffMetadata(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const metadataList = [];
  let hasLocation = false;

  // Mac epoch (1904-01-01) offset to Unix epoch (1970-01-01) in seconds
  const MAC_TO_UNIX_OFFSET = 2082844800;

  function readString(offset, length) {
    let str = '';
    for (let i = 0; i < length; i++) {
      const charCode = view.getUint8(offset + i);
      if (charCode === 0) break;
      str += String.fromCharCode(charCode);
    }
    return str;
  }

  function readFourCC(offset) {
    let str = '';
    for (let i = 0; i < 4; i++) {
      str += String.fromCharCode(view.getUint8(offset + i));
    }
    return str;
  }

  // Recursive Box Walker
  function walkBoxes(startOffset, endOffset, depth = 0) {
    let offset = startOffset;

    while (offset + 8 <= endOffset) {
      const boxSize32 = view.getUint32(offset);
      const boxType = readFourCC(offset + 4);

      let headerSize = 8;
      let boxSize = boxSize32;

      if (boxSize32 === 1) {
        // 64-bit extended box size
        if (offset + 16 > endOffset) break;
        // BigInt 64-bit size
        const high = view.getUint32(offset + 8);
        const low = view.getUint32(offset + 12);
        boxSize = high * 4294967296 + low;
        headerSize = 16;
      } else if (boxSize32 === 0) {
        // Box extends to end of file
        boxSize = endOffset - offset;
      }

      if (boxSize < headerSize || offset + boxSize > endOffset) {
        break;
      }

      const bodyOffset = offset + headerSize;
      const bodySize = boxSize - headerSize;

      // Handle Container Boxes
      if (['moov', 'udta', 'trak', 'mdia', 'minf', 'stbl'].includes(boxType)) {
        walkBoxes(bodyOffset, offset + boxSize, depth + 1);
      } else if (boxType === 'meta') {
        // Meta box has 4 bytes version/flags before child boxes
        walkBoxes(bodyOffset + 4, offset + boxSize, depth + 1);
      } else if (boxType === 'ilst') {
        // iTunes Metadata List Box
        parseIlstBox(bodyOffset, offset + boxSize);
      } else if (boxType === 'keys') {
        // QuickTime Keys Box
        parseKeysBox(bodyOffset, offset + boxSize);
      } else if (boxType === 'mvhd') {
        // Movie Header Box
        parseMvhdBox(bodyOffset, bodySize);
      } else if (boxType === 'tkhd') {
        // Track Header Box
        parseTkhdBox(bodyOffset, bodySize);
      } else if (boxType === 'location' || boxType === 'LOC' || boxType === 'xyz ') {
        // GPS Location Box
        hasLocation = true;
        parseLocationBox(bodyOffset, bodySize);
      }

      offset += boxSize;
    }
  }

  // Parse Movie Header Box for creation and modification time
  function parseMvhdBox(offset, size) {
    if (size < 12) return;
    const version = view.getUint8(offset);
    let creationTimeSec = 0;
    let modTimeSec = 0;

    if (version === 1) {
      if (size < 28) return;
      // 64-bit timestamps
      const createHigh = view.getUint32(offset + 4);
      const createLow = view.getUint32(offset + 8);
      creationTimeSec = (createHigh * 4294967296 + createLow) - MAC_TO_UNIX_OFFSET;

      const modHigh = view.getUint32(offset + 12);
      const modLow = view.getUint32(offset + 16);
      modTimeSec = (modHigh * 4294967296 + modLow) - MAC_TO_UNIX_OFFSET;
    } else {
      // 32-bit timestamps
      const createSec = view.getUint32(offset + 4);
      creationTimeSec = createSec > 0 ? createSec - MAC_TO_UNIX_OFFSET : 0;

      const modSec = view.getUint32(offset + 8);
      modTimeSec = modSec > 0 ? modSec - MAC_TO_UNIX_OFFSET : 0;
    }

    if (creationTimeSec > 0 && creationTimeSec < 2524608000) { // Valid timestamp
      const dateStr = new Date(creationTimeSec * 1000).toISOString();
      if (!metadataList.some(m => m.key === 'creationDate')) {
        metadataList.push({
          category: 'Timestamps',
          name: 'Creation Time',
          key: 'creationDate',
          value: dateStr,
          removable: true
        });
      }
    }

    if (modTimeSec > 0 && modTimeSec < 2524608000) {
      const modDateStr = new Date(modTimeSec * 1000).toISOString();
      if (!metadataList.some(m => m.key === 'modificationDate')) {
        metadataList.push({
          category: 'Timestamps',
          name: 'Modification Time',
          key: 'modificationDate',
          value: modDateStr,
          removable: true
        });
      }
    }
  }

  // Parse Track Header Box
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
      if (!metadataList.some(m => m.key === 'trackCreationDate')) {
        metadataList.push({
          category: 'Timestamps',
          name: 'Track Creation Time',
          key: 'trackCreationDate',
          value: dateStr,
          removable: true
        });
      }
    }
  }

  // Parse GPS Location Box
  function parseLocationBox(offset, size) {
    const rawStr = readString(offset, Math.min(size, 100));
    const match = rawStr.match(/([+-]\d{2}\.\d{4,8})([+-]\d{3}\.\d{4,8})/);
    if (match) {
      hasLocation = true;
      metadataList.push({
        category: 'Location',
        name: 'GPS Location Data',
        key: 'location',
        value: `${match[1]}, ${match[2]} (Location Coordinates Detected)`,
        removable: true
      });
    } else {
      hasLocation = true;
      metadataList.push({
        category: 'Location',
        name: 'GPS Location Data',
        key: 'location',
        value: 'Embedded Location Data Detected',
        removable: true
      });
    }
  }

  // Parse QuickTime Keys Box (Apple QuickTime key definitions)
  const quicktimeKeys = [];
  function parseKeysBox(offset, endOffset) {
    if (offset + 8 > endOffset) return;
    const entryCount = view.getUint32(offset + 4);
    let ptr = offset + 8;

    for (let i = 1; i <= entryCount && ptr + 8 <= endOffset; i++) {
      const keySize = view.getUint32(ptr);
      const keyNamespace = readFourCC(ptr + 4);
      if (keySize > 8 && ptr + keySize <= endOffset) {
        const keyName = readString(ptr + 8, keySize - 8);
        quicktimeKeys[i] = keyName;
      }
      ptr += keySize;
    }
  }

  // Parse iTunes / QuickTime ilst Metadata Box
  function parseIlstBox(startOffset, endOffset) {
    let ptr = startOffset;

    while (ptr + 8 <= endOffset) {
      const itemSize = view.getUint32(ptr);
      if (itemSize < 8 || ptr + itemSize > endOffset) break;

      const itemTypeNum = view.getUint32(ptr + 4);
      const fourCC = readFourCC(ptr + 4);
      const itemBodyOffset = ptr + 8;
      const itemBodyEnd = ptr + itemSize;

      // Extract 'data' atom inside ilst item
      let dataVal = null;
      let dPtr = itemBodyOffset;

      while (dPtr + 8 <= itemBodyEnd) {
        const dSize = view.getUint32(dPtr);
        const dType = readFourCC(dPtr + 4);
        if (dType === 'data' && dSize >= 16 && dPtr + dSize <= itemBodyEnd) {
          const typeIndicator = view.getUint32(dPtr + 8); // 1 = UTF-8, 21 = integer, 0 = implicit
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
        let tagCategory = 'Container Metadata';
        let tagName = fourCC;
        let tagKey = fourCC;

        // Check if itemTypeNum is an index into quicktimeKeys
        if (quicktimeKeys[itemTypeNum]) {
          const qtKey = quicktimeKeys[itemTypeNum];
          tagKey = qtKey;
          if (qtKey.includes('location')) {
            tagCategory = 'Location';
            tagName = 'GPS Location';
            hasLocation = true;
          } else if (qtKey.includes('make')) {
            tagCategory = 'Camera Details';
            tagName = 'Camera Make';
          } else if (qtKey.includes('model')) {
            tagCategory = 'Camera Details';
            tagName = 'Camera Model';
          } else if (qtKey.includes('software')) {
            tagCategory = 'Software';
            tagName = 'Software / OS';
          } else if (qtKey.includes('creationdate')) {
            tagCategory = 'Timestamps';
            tagName = 'Creation Date';
          } else {
            tagName = qtKey.split('.').pop();
          }
        } else {
          // Standard iTunes fourCC mapping
          switch (fourCC) {
            case '©nam': tagName = 'Title'; tagKey = 'title'; break;
            case '©ART': tagName = 'Artist / Author'; tagKey = 'artist'; break;
            case '©alb': tagName = 'Album'; tagKey = 'album'; break;
            case '©cmt': tagName = 'Comment'; tagKey = 'comment'; break;
            case '©gen': tagName = 'Genre'; tagKey = 'genre'; break;
            case '©cpy': tagName = 'Copyright'; tagKey = 'copyright'; break;
            case '©too': tagName = 'Encoder / Software'; tagKey = 'encoder'; tagCategory = 'Software'; break;
            case '©day': tagName = 'Creation Year'; tagKey = 'creationYear'; tagCategory = 'Timestamps'; break;
            case '©xyz':
              tagName = 'GPS Location';
              tagKey = 'location';
              tagCategory = 'Location';
              hasLocation = true;
              break;
          }
        }

        if (!metadataList.some(m => m.key === tagKey)) {
          metadataList.push({
            category: tagCategory,
            name: tagName,
            key: tagKey,
            value: dataVal.trim(),
            removable: true
          });
        }
      }

      ptr += itemSize;
    }
  }

  // Start walking boxes from start of file
  try {
    walkBoxes(0, view.byteLength);
  } catch (e) {
    console.error('Box walker error:', e);
  }

  // Also perform a fast string sweep across the entire buffer for unindexed strings (GPS, iPhone, Android, Encoder)
  const fullTextDecoder = new TextDecoder('latin1');
  const rawLatinStr = fullTextDecoder.decode(new Uint8Array(arrayBuffer));

  // Sweep for ISO6709 Location (+XX.XXXX-YYY.YYYY/)
  const rawGpsMatch = rawLatinStr.match(/([+-]\d{2}\.\d{4,8})([+-]\d{3}\.\d{4,8})\/?/);
  if (rawGpsMatch && !metadataList.some(m => m.key === 'location')) {
    hasLocation = true;
    metadataList.push({
      category: 'Location',
      name: 'GPS Location Data',
      key: 'location',
      value: `${rawGpsMatch[1]}, ${rawGpsMatch[2]} (Location Coordinates Detected)`,
      removable: true
    });
  }

  // Sweep for iPhone / Android device make & model if missed
  if (!metadataList.some(m => m.key === 'make')) {
    const makeMatch = rawLatinStr.match(/com\.apple\.quicktime\.make[^\w]*([A-Za-z0-9\s]{2,20})/i);
    if (makeMatch && makeMatch[1]) {
      metadataList.push({
        category: 'Camera Details',
        name: 'Camera Make',
        key: 'make',
        value: makeMatch[1].trim(),
        removable: true
      });
    }
  }

  if (!metadataList.some(m => m.key === 'model')) {
    const modelMatch = rawLatinStr.match(/com\.apple\.quicktime\.model[^\w]*([A-Za-z0-9\s]{2,30})/i);
    if (modelMatch && modelMatch[1]) {
      metadataList.push({
        category: 'Camera Details',
        name: 'Camera Model',
        key: 'model',
        value: modelMatch[1].trim(),
        removable: true
      });
    }
  }

  if (!metadataList.some(m => m.key === 'encoder')) {
    const encoderMatch = rawLatinStr.match(/Lavf[0-9.]+|HandBrake|CapCut|Adobe|Premiere|DaVinci|QuickTime/i);
    if (encoderMatch) {
      metadataList.push({
        category: 'Software',
        name: 'Encoder / Handler',
        key: 'encoder',
        value: encoderMatch[0],
        removable: true
      });
    }
  }

  return {
    success: true,
    metadataList,
    totalCount: metadataList.length,
    hasMetadata: metadataList.length > 0,
    hasLocation
  };
}
