import ExifReader from 'exifreader';
import piexif from 'piexifjs';

/**
 * Categorize tags into user-friendly groups
 */
export function categorizeTags(tags) {
  const categories = {
    location: [],
    camera: [],
    datetime: [],
    author: [],
    software: [],
    other: []
  };

  if (!tags) return categories;

  Object.keys(tags).forEach((tagName) => {
    // Skip binary thumbnails or raw unreadable objects
    if (tagName === 'Thumbnail' || tagName === 'base64') return;

    const tagObj = tags[tagName];
    const value = tagObj.description || tagObj.value || String(tagObj);
    const tagLower = tagName.toLowerCase();

    const tagData = {
      name: tagName,
      value: Array.isArray(value) ? value.join(', ') : String(value)
    };

    // Location / GPS
    if (tagLower.includes('gps') || tagLower.includes('latitude') || tagLower.includes('longitude') || tagLower.includes('altitude') || tagLower.includes('location')) {
      categories.location.push(tagData);
    }
    // Camera / Device
    else if (
      tagLower.includes('make') || tagLower.includes('model') || tagLower.includes('lens') || 
      tagLower.includes('fnumber') || tagLower.includes('exposure') || tagLower.includes('iso') || 
      tagLower.includes('focallength') || tagLower.includes('flash') || tagLower.includes('aperture') ||
      tagLower.includes('shutter') || tagLower.includes('metering') || tagLower.includes('serial')
    ) {
      categories.camera.push(tagData);
    }
    // Date & Time
    else if (tagLower.includes('date') || tagLower.includes('time') || tagLower.includes('timestamp')) {
      categories.datetime.push(tagData);
    }
    // Author / Copyright
    else if (tagLower.includes('artist') || tagLower.includes('author') || tagLower.includes('copyright') || tagLower.includes('owner') || tagLower.includes('creator')) {
      categories.author.push(tagData);
    }
    // Software
    else if (tagLower.includes('software') || tagLower.includes('processing') || tagLower.includes('hostcomputer') || tagLower.includes('firmware')) {
      categories.software.push(tagData);
    }
    // Other technical tags
    else {
      categories.other.push(tagData);
    }
  });

  return categories;
}

/**
 * Extract metadata from a File using ExifReader
 */
export async function scanFileMetadata(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    // Expand tags parsing options
    const tags = ExifReader.load(arrayBuffer, { expanded: true });
    
    // Flatten tags into unified dictionary for display
    const rawTags = {};
    if (tags.exif) Object.assign(rawTags, tags.exif);
    if (tags.gps) Object.assign(rawTags, tags.gps);
    if (tags.iptc) Object.assign(rawTags, tags.iptc);
    if (tags.xmp) Object.assign(rawTags, tags.xmp);
    if (tags.file) Object.assign(rawTags, tags.file);
    if (tags.png) Object.assign(rawTags, tags.png);
    
    // Remove system file properties that aren't metadata
    delete rawTags['Bits Per Sample'];
    delete rawTags['Color Components'];
    
    const categories = categorizeTags(rawTags);
    const totalCount = Object.keys(rawTags).length;
    const hasLocation = categories.location.length > 0;

    return {
      success: true,
      rawTags,
      categories,
      totalCount,
      hasLocation,
      locationTags: categories.location
    };
  } catch (err) {
    // File might have no EXIF headers or unsupported header structure
    return {
      success: true,
      rawTags: {},
      categories: categorizeTags({}),
      totalCount: 0,
      hasLocation: false,
      locationTags: []
    };
  }
}

/**
 * Remove EXIF / Metadata from JPEG array buffer by stripping APP markers
 */
function stripJpegAppMarkers(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  let offset = 0;
  
  // Verify JPEG header (0xFFD8)
  if (view.getUint16(0, false) !== 0xFFD8) {
    throw new Error('Not a valid JPEG file');
  }
  
  offset += 2;
  const chunks = [new Uint8Array(arrayBuffer, 0, 2)]; // Keep SOI header
  
  while (offset < view.byteLength) {
    if (offset + 2 > view.byteLength) break;
    const marker = view.getUint16(offset, false);
    
    // SOS (Start of Scan 0xFFDA) or EOI (End of Image 0xFFD9) - image data starts here
    if (marker === 0xFFDA || marker === 0xFFD9) {
      chunks.push(new Uint8Array(arrayBuffer, offset));
      break;
    }
    
    // Handle markers with payload size
    if (marker >= 0xFF00) {
      const length = view.getUint16(offset + 2, false);
      // APP1 to APP15 markers (0xFFE1 to 0xFFEF) contain EXIF, XMP, IPTC, ICC profiles etc.
      // COM marker (0xFFFE) contains comments.
      const isMetadataMarker = (marker >= 0xFFE1 && marker <= 0xFFEF) || marker === 0xFFFE;
      
      if (!isMetadataMarker) {
        // Retain non-metadata markers (like APP0 / JFIF, DQT, DHT, SOF0)
        chunks.push(new Uint8Array(arrayBuffer, offset, 2 + length));
      }
      
      offset += 2 + length;
    } else {
      offset++;
    }
  }
  
  // Combine chunks into single ArrayBuffer
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const resultBuffer = new Uint8Array(totalLength);
  let currentPos = 0;
  for (const chunk of chunks) {
    resultBuffer.set(chunk, currentPos);
    currentPos += chunk.length;
  }
  
  return resultBuffer;
}

/**
 * Canvas export fallback for clean image creation
 */
function cleanImageViaCanvas(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      const mimeType = file.type === 'image/png' ? 'image/png' : (file.type === 'image/webp' ? 'image/webp' : 'image/jpeg');
      const quality = mimeType === 'image/png' ? undefined : 0.95;

      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Canvas export failed'));
        }
      }, mimeType, quality);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image into canvas'));
    };

    img.src = url;
  });
}

/**
 * Main Metadata Removal Function
 */
export async function removeMetadata(file) {
  const type = file.type.toLowerCase();
  
  try {
    // 1. JPEG / JPG processing
    if (type.includes('jpeg') || type.includes('jpg')) {
      const arrayBuffer = await file.arrayBuffer();
      try {
        // Try fast binary marker stripping first
        const cleanBuffer = stripJpegAppMarkers(arrayBuffer);
        return new Blob([cleanBuffer], { type: 'image/jpeg' });
      } catch (e) {
        // Fallback to piexifjs
        try {
          const dataUrl = await new Promise((res, rej) => {
            const reader = new FileReader();
            reader.onload = () => res(reader.result);
            reader.onerror = rej;
            reader.readAsDataURL(file);
          });
          const cleanDataUrl = piexif.remove(dataUrl);
          const response = await fetch(cleanDataUrl);
          return await response.blob();
        } catch (piexifErr) {
          // Final fallback: Canvas re-render
          return await cleanImageViaCanvas(file);
        }
      }
    }

    // 2. PNG & WebP Processing: Canvas clean export (guarantees 0 metadata chunks)
    if (type.includes('png') || type.includes('webp')) {
      return await cleanImageViaCanvas(file);
    }

    // Default fallback
    return await cleanImageViaCanvas(file);
  } catch (err) {
    console.error('Error removing metadata:', err);
    // Final safe fallback
    return await cleanImageViaCanvas(file);
  }
}

/**
 * Verify cleaned file by rescanning output
 */
export async function verifyCleanFile(cleanedBlob, originalInput = 0) {
  const cleanFile = new File([cleanedBlob], 'cleaned_output.jpg', { type: cleanedBlob.type });
  const rescanResult = await scanFileMetadata(cleanFile);
  
  const remainingCount = Math.max(0, Number(rescanResult.totalCount) || 0);
  const locationRemaining = Boolean(rescanResult.hasLocation);
  
  let rawOriginal = 0;
  if (typeof originalInput === 'object' && originalInput !== null) {
    rawOriginal = originalInput.totalCount || 0;
  } else {
    rawOriginal = originalInput;
  }

  const totalOriginal = Math.max(0, Number(rawOriginal) || 0);
  const removedCount = totalOriginal > 0 ? Math.max(0, totalOriginal - remainingCount) : 0;
  const isFullyClean = remainingCount === 0 && !locationRemaining;
  
  return {
    verified: isFullyClean,
    hasRemaining: remainingCount > 0,
    remainingCount,
    removedCount,
    totalOriginal,
    hasLocation: locationRemaining,
    remainingCategories: rescanResult.categories || categorizeTags({}),
    rescanCategories: rescanResult.categories || categorizeTags({})
  };
}
