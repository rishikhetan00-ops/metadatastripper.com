import fs from 'fs';

/**
 * Complete Generic MP4 & MOV Metadata Parser with Smart Box Walker, Vendor Key Indexing & XMP Extraction
 */
export function parseIsobmffMetadataComprehensive(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const privacyList = [];
  const technicalList = [];
  let hasLocation = false;

  const MAC_TO_UNIX_OFFSET = 2082844800;

  function readString(offset, length) {
    let str = '';
    for (let i = 0; i < length; i++) {
      if (offset + i >= view.byteLength) break;
      const b = view.getUint8(offset + i);
      if (b === 0) break;
      str += String.fromCharCode(b);
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

  function classifyAndAddItem(item) {
    const k = (item.name + ' ' + item.key + ' ' + item.category).toLowerCase();
    const isPrivacy = k.includes('location') || k.includes('gps') || k.includes('device') || k.includes('model') || k.includes('make') || k.includes('lens') || k.includes('focal') || k.includes('aperture') || k.includes('camera') || k.includes('creation') || k.includes('date');

    item.isPrivacy = isPrivacy;
    item.status = 'removable';
    item.removable = true;

    const targetList = isPrivacy ? privacyList : technicalList;
    if (!targetList.some(m => m.key === item.key)) {
      targetList.push(item);
    }
  }

  // Smart Container Box Walker
  function walkBoxes(startOffset, endOffset) {
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

      if (['moov', 'udta', 'trak', 'mdia', 'minf', 'stbl'].includes(boxType)) {
        walkBoxes(bodyOffset, offset + boxSize);
      } else if (boxType === 'meta') {
        // Smart meta box header detection (FullBox vs Plain Box)
        const fourCCAt0 = readFourCC(bodyOffset + 4);
        const fourCCAt4 = readFourCC(bodyOffset + 8);
        const knownChildren = ['hdlr', 'keys', 'ilst', 'xml ', 'bxml', 'dinf'];

        let childrenStart = bodyOffset;
        if (knownChildren.includes(fourCCAt4)) childrenStart = bodyOffset + 4;
        else if (knownChildren.includes(fourCCAt0)) childrenStart = bodyOffset;
        else if (view.getUint8(bodyOffset) === 0) childrenStart = bodyOffset + 4;

        walkBoxes(childrenStart, offset + boxSize);
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
      } else if (boxType === 'XMP_' || boxType === 'xml ') {
        parseXmlBox(bodyOffset, bodySize);
      }

      offset += boxSize;
    }
  }

  // Parse hdlr box
  function parseHdlrBox(offset, size) {
    if (size < 24) return;
    const componentSubtype = readFourCC(offset + 8);
    const handlerName = readString(offset + 24, size - 24).trim();
    if (handlerName && handlerName !== 'VideoHandler' && handlerName !== 'SoundHandler') {
      const keyName = componentSubtype === 'vide' ? 'Video Handler' : 'Audio Handler';
      classifyAndAddItem({
        category: 'Technical',
        name: keyName,
        key: `hdlr_${componentSubtype}`,
        value: handlerName,
        source: 'hdlr atom',
        originalKey: `hdlr.${componentSubtype}`
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
      classifyAndAddItem({
        category: 'Date & Time',
        name: 'Creation Time',
        key: 'creationDate',
        value: dateStr,
        source: 'mvhd atom',
        originalKey: 'mvhd.creation_time'
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
      classifyAndAddItem({
        category: 'Technical',
        name: 'Track Creation Time',
        key: 'trackCreationDate',
        value: dateStr,
        source: 'tkhd atom',
        originalKey: 'tkhd.creation_time'
      });
    }
  }

  // Parse Location box
  function parseLocationBox(offset, size) {
    hasLocation = true;
    classifyAndAddItem({
      category: 'Location',
      name: 'GPS Location Data',
      key: 'location',
      value: 'Location Data Detected',
      source: 'udta.location',
      originalKey: 'location'
    });
  }

  // Parse Xml / XMP box
  function parseXmlBox(offset, size) {
    const xmlStr = readString(offset, Math.min(size, 2000));
    
    // Extract camera model from XML
    const modelMatch = xmlStr.match(/<tiff:Model>([^<]+)<\/tiff:Model>/) || xmlStr.match(/Model="([^"]+)"/);
    if (modelMatch && modelMatch[1]) {
      classifyAndAddItem({ category: 'Device', name: 'Device Model', key: 'xmp_model', value: modelMatch[1], source: 'XMP atom', originalKey: 'tiff:Model' });
    }
    const makeMatch = xmlStr.match(/<tiff:Make>([^<]+)<\/tiff:Make>/) || xmlStr.match(/Make="([^"]+)"/);
    if (makeMatch && makeMatch[1]) {
      classifyAndAddItem({ category: 'Device', name: 'Camera Make', key: 'xmp_make', value: makeMatch[1], source: 'XMP atom', originalKey: 'tiff:Make' });
    }
    const lensMatch = xmlStr.match(/<exif:LensModel>([^<]+)<\/exif:LensModel>/) || xmlStr.match(/LensModel="([^"]+)"/);
    if (lensMatch && lensMatch[1]) {
      classifyAndAddItem({ category: 'Camera', name: 'Camera Lens', key: 'xmp_lens', value: lensMatch[1], source: 'XMP atom', originalKey: 'exif:LensModel' });
    }
    const focalMatch = xmlStr.match(/<exif:FocalLength>([^<]+)<\/exif:FocalLength>/) || xmlStr.match(/FocalLength="([^"]+)"/);
    if (focalMatch && focalMatch[1]) {
      classifyAndAddItem({ category: 'Camera', name: 'Focal Length', key: 'xmp_focal', value: focalMatch[1], source: 'XMP atom', originalKey: 'exif:FocalLength' });
    }
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

  // Parse ilst box
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
        let category = 'Container Metadata';

        if (quicktimeKeys[itemTypeNum]) {
          rawKey = quicktimeKeys[itemTypeNum];
          const kLower = rawKey.toLowerCase();
          
          if (kLower.includes('location')) { category = 'Location'; displayName = 'GPS Location'; hasLocation = true; }
          else if (kLower.includes('model') || kLower.includes('product')) { category = 'Device'; displayName = 'Device Model'; }
          else if (kLower.includes('make') || kLower.includes('manufacturer')) { category = 'Device'; displayName = 'Camera Make'; }
          else if (kLower.includes('version') || kLower.includes('android') || kLower.includes('os')) { category = 'Device'; displayName = 'OS Version'; }
          else if (kLower.includes('lens')) { category = 'Camera'; displayName = 'Camera Lens'; }
          else if (kLower.includes('focal')) { category = 'Camera'; displayName = 'Focal Length'; }
          else if (kLower.includes('aperture')) { category = 'Camera'; displayName = 'Aperture'; }
          else if (kLower.includes('software')) { category = 'Software'; displayName = 'Software'; }
          else if (kLower.includes('creationdate')) { category = 'Date & Time'; displayName = 'Creation Time'; }
          else {
            const parts = rawKey.split('.');
            displayName = parts.slice(-2).join(' ').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          }
        } else {
          switch (fourCC) {
            case '©nam': displayName = 'Title'; category = 'Descriptive'; break;
            case '©ART': displayName = 'Artist'; category = 'Descriptive'; break;
            case '©alb': displayName = 'Album'; category = 'Descriptive'; break;
            case '©cmt': displayName = 'Comment'; category = 'Descriptive'; break;
            case '©gen': displayName = 'Genre'; category = 'Descriptive'; break;
            case '©cpy': displayName = 'Copyright'; category = 'Descriptive'; break;
            case '©too': displayName = 'Encoder'; category = 'Software'; break;
            case '©day': displayName = 'Creation Time'; category = 'Date & Time'; break;
            case '©xyz': displayName = 'GPS Location'; category = 'Location'; hasLocation = true; break;
          }
        }

        classifyAndAddItem({
          category,
          name: displayName,
          key: rawKey,
          value: dataVal.trim(),
          source: 'ilst atom',
          originalKey: rawKey
        });
      }

      ptr += itemSize;
    }
  }

  // Execute walk
  try {
    walkBoxes(0, view.byteLength);
  } catch (e) {
    console.error('Walk error:', e);
  }

  // Fallback Latin1 sweep for ISO6709 location and vendor keys
  try {
    const fullDecoder = new TextDecoder('latin1');
    const rawLatinStr = fullDecoder.decode(new Uint8Array(arrayBuffer));

    const rawGpsMatch = rawLatinStr.match(/([+-]\d{2}\.\d{4,8})([+-]\d{3}\.\d{4,8})\/?/);
    if (rawGpsMatch && !privacyList.some(m => m.key === 'location')) {
      hasLocation = true;
      classifyAndAddItem({
        category: 'Location',
        name: 'GPS Location Data',
        key: 'location',
        value: 'Location Data Detected',
        source: 'ISO6709 pattern',
        originalKey: 'location.ISO6709'
      });
    }

    const vendorMatches = rawLatinStr.matchAll(/(com\.[a-z0-9_.]+=?[\w\d.\s:-]{2,50})/gi);
    for (const match of vendorMatches) {
      const kv = match[0];
      const parts = kv.split(/=|\x00/);
      if (parts.length >= 2) {
        const vKey = parts[0].trim();
        const vVal = parts[1].trim();
        if (vKey.length > 5 && vVal.length > 1) {
          let category = 'Other';
          let displayName = vKey.split('.').pop().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          if (vKey.includes('model') || vKey.includes('product')) { category = 'Device'; displayName = 'Device Model'; }
          else if (vKey.includes('version') || vKey.includes('android')) { category = 'Device'; displayName = 'OS Version'; }
          else if (vKey.includes('lens')) { category = 'Camera'; displayName = 'Camera Lens'; }
          else if (vKey.includes('focal')) { category = 'Camera'; displayName = 'Focal Length'; }
          else if (vKey.includes('aperture')) { category = 'Camera'; displayName = 'Aperture'; }

          classifyAndAddItem({
            category,
            name: displayName,
            key: vKey,
            value: vVal,
            source: 'vendor string sweep',
            originalKey: vKey
          });
        }
      }
    }
  } catch (e) {}

  const allMetadata = [...privacyList, ...technicalList];

  return {
    success: true,
    privacyMetadata: privacyList,
    technicalMetadata: technicalList,
    metadataList: allMetadata,
    totalCount: allMetadata.length,
    privacyCount: privacyList.length,
    technicalCount: technicalList.length,
    hasPrivacyMetadata: privacyList.length > 0,
    hasTechnicalMetadata: technicalList.length > 0,
    hasMetadata: allMetadata.length > 0,
    hasLocation
  };
}
