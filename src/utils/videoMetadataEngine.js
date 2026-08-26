import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

// Configurable Memory & File Size Limits
export const MAX_DESKTOP_VIDEO_SIZE_MB = 1000;
export const MAX_MOBILE_VIDEO_SIZE_MB = 350;
export const LARGE_VIDEO_WARN_THRESHOLD_MB = 300;

let ffmpegInstance = null;

/**
 * Detect whether current client is a mobile device
 */
export function isMobileDevice() {
  if (typeof window === 'undefined') return false;
  const userAgent = navigator.userAgent || navigator.vendor || window.opera;
  const isTouch = navigator.maxTouchPoints && navigator.maxTouchPoints > 1;
  return /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent) || (isTouch && window.innerWidth <= 820);
}

/**
 * Get maximum allowed file size for the current device
 */
export function getMaxAllowedFileSizeMB() {
  return isMobileDevice() ? MAX_MOBILE_VIDEO_SIZE_MB : MAX_DESKTOP_VIDEO_SIZE_MB;
}

/**
 * Lazy-load FFmpeg Single-Threaded WASM Core ONLY when video processing is requested
 */
export async function getFFmpeg(onProgress = () => {}) {
  if (ffmpegInstance && ffmpegInstance.loaded) {
    return ffmpegInstance;
  }

  ffmpegInstance = new FFmpeg();
  
  if (typeof onProgress === 'function') {
    ffmpegInstance.on('progress', ({ progress }) => {
      onProgress(progress);
    });
  }

  try {
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
    await ffmpegInstance.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm')
    });
    return ffmpegInstance;
  } catch (err) {
    console.error('FFmpeg WASM initialization error:', err);
    throw new Error('FAILED_TO_INIT_FFMPEG');
  }
}

/**
 * Clean up memory resources
 */
export function cleanupFFmpeg() {
  if (ffmpegInstance && ffmpegInstance.loaded) {
    try {
      ffmpegInstance.terminate();
      ffmpegInstance = null;
    } catch (e) {}
  }
}

/**
 * Exact Key & Category Auto-Mapper for MP4 / MOV Metadata
 */
export function categorizeKey(keyName, originalKey = '') {
  const k = (originalKey + ' ' + keyName).toLowerCase();

  // 1. Camera Lens & Parameters (Check BEFORE generic 'model')
  if (k.includes('lens.model') || k.includes('lens_model') || (k.includes('lens') && k.includes('model'))) {
    return { category: 'Camera', label: 'Lens Model' };
  }
  if (k.includes('focal_length') || k.includes('focallength') || k.includes('focal')) {
    return { category: 'Camera', label: 'Focal Length' };
  }
  if (k.includes('max_aperture') || k.includes('aperture') || k.includes('fnumber')) {
    return { category: 'Camera', label: 'Maximum Aperture' };
  }
  if (k.includes('camera') || k.includes('iso') || k.includes('shutter') || k.includes('exposure')) {
    return { category: 'Camera', label: keyName };
  }

  // 2. Device & OS Version
  if (k.includes('android.version') || k.includes('com.android.version') || k.includes('com.oplus.android.version')) {
    return { category: 'Device', label: 'Android Version' };
  }
  if (k.includes('ios.version') || k.includes('com.apple.ios.version') || (k.includes('apple') && k.includes('software'))) {
    return { category: 'Device', label: 'iOS Version' };
  }
  if (k.includes('os_version') || k.includes('os.version')) {
    return { category: 'Device', label: 'OS Version' };
  }
  if (k.includes('product.model') || k.includes('quicktime.model') || k.includes('device.model') || k.includes('device_model')) {
    return { category: 'Device', label: 'Device Model' };
  }
  if (k.includes('make') || k.includes('manufacturer')) {
    return { category: 'Device', label: 'Camera Make' };
  }
  if (k.includes('model')) {
    return { category: 'Device', label: 'Device Model' };
  }

  // 3. Location & GPS
  if (k.includes('location') || k.includes('gps') || k.includes('latitude') || k.includes('longitude') || k.includes('altitude') || k.includes('iso6709') || k.includes('xyz')) {
    return { category: 'Location', label: 'GPS Location Data' };
  }

  // 4. Timestamps
  if (k.includes('creation') && (k.includes('date') || k.includes('time'))) {
    return { category: 'Date & Time', label: 'Creation Time' };
  }
  if (k.includes('mod') && (k.includes('date') || k.includes('time'))) {
    return { category: 'Date & Time', label: 'Modification Time' };
  }
  if (k.includes('date') || k.includes('time') || k.includes('timestamp')) {
    return { category: 'Date & Time', label: keyName };
  }

  // 5. Software & Handlers
  if (k.includes('hdlr_vide') || k.includes('video handler') || k.includes('videohandle')) {
    return { category: 'Technical', label: 'Video Handler' };
  }
  if (k.includes('hdlr_soun') || k.includes('audio handler') || k.includes('soundhandle')) {
    return { category: 'Technical', label: 'Audio Handler' };
  }
  if (k.includes('software') || k.includes('encoder') || k.includes('app') || k.includes('tool')) {
    return { category: 'Software', label: keyName };
  }

  // 6. Descriptive Tags
  if (k.includes('title') || k.includes('artist') || k.includes('author') || k.includes('album') || k.includes('comment') || k.includes('copyright') || k.includes('genre')) {
    return { category: 'Descriptive', label: keyName };
  }

  return { category: 'Other', label: keyName };
}

/**
 * Comprehensive MP4 / MOV Binary Atom Walker with Smart meta Box Handling & Privacy/Technical Classification
 */
export function parseIsobmffMetadata(arrayBuffer) {
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
    const catInfo = categorizeKey(item.name, item.originalKey || item.key);
    item.category = catInfo.category;
    item.name = catInfo.label;

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
      classifyAndAddItem({ category: 'Camera', name: 'Lens Model', key: 'xmp_lens', value: lensMatch[1], source: 'XMP atom', originalKey: 'exif:LensModel' });
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

        if (quicktimeKeys[itemTypeNum]) {
          rawKey = quicktimeKeys[itemTypeNum];
          displayName = rawKey.split('.').pop().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
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

        classifyAndAddItem({
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
          classifyAndAddItem({
            name: vKey,
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

/**
 * Scan Video File for MP4/MOV container metadata
 */
export async function scanVideoMetadata(file) {
  const maxLimitMb = getMaxAllowedFileSizeMB();
  const fileMb = file.size / (1024 * 1024);

  if (fileMb > maxLimitMb) {
    return {
      success: false,
      error: 'FILE_TOO_LARGE',
      message: `⚠️ This video file (${fileMb.toFixed(1)} MB) exceeds the ${maxLimitMb} MB limit for ${isMobileDevice() ? 'mobile devices' : 'browser processing'}.`,
      metadataList: [],
      privacyMetadata: [],
      technicalMetadata: [],
      totalCount: 0,
      hasLocation: false
    };
  }

  // Format check
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['mp4', 'mov', 'm4v'].includes(ext)) {
    return {
      success: false,
      error: 'UNSUPPORTED_FORMAT',
      message: '⚠️ Unsupported video format. Please upload an MP4 or MOV video file.',
      metadataList: [],
      privacyMetadata: [],
      technicalMetadata: [],
      totalCount: 0,
      hasLocation: false
    };
  }

  try {
    let arrayBuffer = await file.arrayBuffer();
    const result = parseIsobmffMetadata(arrayBuffer);
    arrayBuffer = null;
    return result;
  } catch (err) {
    return {
      success: false,
      error: 'CORRUPTED_VIDEO',
      message: '⚠️ Could not read video container. The video file may be corrupted or unreadable.',
      metadataList: [],
      privacyMetadata: [],
      technicalMetadata: [],
      totalCount: 0,
      hasLocation: false
    };
  }
}

/**
 * Remove Video Metadata using FFmpeg WASM stream copying with Memory Optimization (-c copy -map_metadata -1 -map_chapters -1)
 */
export async function removeVideoMetadata(file, onProgress = () => {}) {
  let ffmpeg;
  try {
    ffmpeg = await getFFmpeg(onProgress);
  } catch (err) {
    throw new Error('Could not initialize processing engine in browser.');
  }

  const ext = file.name.split('.').pop().toLowerCase() || 'mp4';
  const inputFileName = `input.${ext}`;
  const outputFileName = `output.${ext}`;

  try {
    const fetchedFileData = await fetchFile(file);
    await ffmpeg.writeFile(inputFileName, fetchedFileData);

    await ffmpeg.exec([
      '-i', inputFileName,
      '-map_metadata', '-1',
      '-map_chapters', '-1',
      '-c', 'copy',
      outputFileName
    ]);

    const data = await ffmpeg.readFile(outputFileName);

    try {
      await ffmpeg.deleteFile(inputFileName);
      await ffmpeg.deleteFile(outputFileName);
    } catch (e) {}

    const mimeType = ext === 'mov' ? 'video/quicktime' : 'video/mp4';
    return new Blob([data.buffer], { type: mimeType });
  } catch (err) {
    console.error('FFmpeg processing error:', err);
    if (err.message && (err.message.includes('OOM') || err.message.includes('memory') || err.message.includes('RangeError'))) {
      throw new Error('Your browser ran out of memory while processing this large video file. Try a smaller file or use a desktop browser.');
    }
    throw new Error('Failed to process video file. The file format may be incompatible or corrupted.');
  }
}

/**
 * Rescan cleaned video and verify metadata removal accurately
 */
export async function verifyCleanVideo(cleanedBlob, originalMetadataList = []) {
  try {
    const cleanFile = new File([cleanedBlob], 'cleaned_output.mp4', { type: cleanedBlob.type });
    const rescanResult = await scanVideoMetadata(cleanFile);

    const verificationItems = originalMetadataList.map(item => {
      const foundInRescan = rescanResult.metadataList.find(m => m.key === item.key);
      return {
        category: item.category,
        name: item.name,
        key: item.key,
        value: item.value,
        isPrivacy: item.isPrivacy,
        removed: !foundInRescan
      };
    });

    const allRemoved = verificationItems.every(item => item.removed);
    const removedCount = verificationItems.filter(item => item.removed).length;
    const remainingItems = verificationItems.filter(item => !item.removed);

    return {
      verified: allRemoved,
      removedCount,
      totalOriginal: originalMetadataList.length,
      verificationItems,
      remainingItems,
      hasRemaining: remainingItems.length > 0
    };
  } catch (err) {
    return {
      verified: false,
      removedCount: 0,
      totalOriginal: originalMetadataList.length,
      verificationItems: [],
      remainingItems: originalMetadataList,
      hasRemaining: true
    };
  }
}
