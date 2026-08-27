import { PDFDocument, PDFName } from 'pdf-lib';

/**
 * Extract metadata fields from a PDF file using pdf-lib
 */
export async function scanPdfMetadata(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();

    let pdfDoc;
    try {
      pdfDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
    } catch (parseErr) {
      if (parseErr.message && parseErr.message.toLowerCase().includes('encrypted')) {
        return {
          success: false,
          error: 'PASSWORD_PROTECTED',
          message: '⚠️ This PDF is password-protected or encrypted. Please unlock it before removing metadata.',
          metadataList: [],
          totalCount: 0
        };
      }
      return {
        success: false,
        error: 'CORRUPTED',
        message: '⚠️ Could not parse file as a valid PDF. The file may be corrupted.',
        metadataList: [],
        totalCount: 0
      };
    }

    if (pdfDoc.isEncrypted) {
      return {
        success: false,
        error: 'PASSWORD_PROTECTED',
        message: '⚠️ This PDF is password-protected or encrypted. Please unlock it before removing metadata.',
        metadataList: [],
        totalCount: 0
      };
    }

    const title = pdfDoc.getTitle();
    const author = pdfDoc.getAuthor();
    const subject = pdfDoc.getSubject();
    const keywords = pdfDoc.getKeywords();
    const creator = pdfDoc.getCreator();
    const producer = pdfDoc.getProducer();
    const creationDate = pdfDoc.getCreationDate();
    const modificationDate = pdfDoc.getModificationDate();

    // Check for XMP metadata catalog entry
    let hasXmp = false;
    try {
      const catalog = pdfDoc.catalog;
      hasXmp = catalog.has(PDFName.of('Metadata'));
    } catch (e) {
      hasXmp = false;
    }

    const metadataList = [];

    if (title && title.trim()) {
      metadataList.push({ name: 'Title', value: title, key: 'title' });
    }
    if (author && author.trim()) {
      metadataList.push({ name: 'Author', value: author, key: 'author' });
    }
    if (subject && subject.trim()) {
      metadataList.push({ name: 'Subject', value: subject, key: 'subject' });
    }
    if (keywords && (Array.isArray(keywords) ? keywords.length > 0 : String(keywords).trim())) {
      const kwVal = Array.isArray(keywords) ? keywords.join(', ') : String(keywords);
      if (kwVal.trim()) {
        metadataList.push({ name: 'Keywords', value: kwVal, key: 'keywords' });
      }
    }
    if (creator && creator.trim()) {
      metadataList.push({ name: 'Creator', value: creator, key: 'creator' });
    }
    if (producer && producer.trim()) {
      metadataList.push({ name: 'Producer', value: producer, key: 'producer' });
    }
    if (creationDate) {
      metadataList.push({ name: 'Creation Date', value: creationDate.toISOString(), key: 'creationDate' });
    }
    if (modificationDate) {
      metadataList.push({ name: 'Modification Date', value: modificationDate.toISOString(), key: 'modificationDate' });
    }
    if (hasXmp) {
      metadataList.push({ name: 'XMP Metadata', value: 'Embedded XML Stream Present', key: 'xmp' });
    }

    return {
      success: true,
      metadataList,
      totalCount: metadataList.length,
      hasMetadata: metadataList.length > 0
    };
  } catch (err) {
    return {
      success: false,
      error: 'PARSE_ERROR',
      message: '⚠️ An unexpected error occurred while reading the PDF.',
      metadataList: [],
      totalCount: 0
    };
  }
}

/**
 * Remove metadata from a PDF file using pdf-lib while preserving pages, text, images, and formatting
 */
export async function removePdfMetadata(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdfDoc = await PDFDocument.load(arrayBuffer);

  // 1. Delete all metadata entries directly from the PDF Info dictionary
  try {
    const infoDict = pdfDoc.getInfoDict();
    if (infoDict) {
      infoDict.delete(PDFName.of('Title'));
      infoDict.delete(PDFName.of('Author'));
      infoDict.delete(PDFName.of('Subject'));
      infoDict.delete(PDFName.of('Keywords'));
      infoDict.delete(PDFName.of('Creator'));
      infoDict.delete(PDFName.of('Producer'));
      infoDict.delete(PDFName.of('CreationDate'));
      infoDict.delete(PDFName.of('ModDate'));
      infoDict.delete(PDFName.of('Trapped'));
      infoDict.delete(PDFName.of('PTEX.Fullbanner'));
    }
  } catch (e) {
    // ignore if info dict delete fails
  }

  // 2. Clear instance properties to prevent auto-re-injection
  pdfDoc.setTitle('');
  pdfDoc.setAuthor('');
  pdfDoc.setSubject('');
  pdfDoc.setKeywords([]);
  pdfDoc.setCreator('');
  pdfDoc.setProducer('');

  pdfDoc.title = undefined;
  pdfDoc.author = undefined;
  pdfDoc.subject = undefined;
  pdfDoc.keywords = undefined;
  pdfDoc.creator = undefined;
  pdfDoc.producer = undefined;
  pdfDoc.creationDate = undefined;
  pdfDoc.modificationDate = undefined;

  // 3. Delete XMP metadata catalog stream if present
  try {
    const catalog = pdfDoc.catalog;
    const metadataKey = PDFName.of('Metadata');
    if (catalog.has(metadataKey)) {
      catalog.delete(metadataKey);
    }
  } catch (e) {
    // ignore if XMP delete fails
  }

  // 4. Disable pdf-lib default updateInfoDict hook to prevent default Producer/Date injection
  pdfDoc.updateInfoDict = () => {};

  // 5. Save modified PDF with updateInfoDict: false
  const pdfBytes = await pdfDoc.save({ updateInfoDict: false });
  return new Blob([pdfBytes], { type: 'application/pdf' });
}

/**
 * Rescan output PDF and verify metadata removal
 */
export async function verifyCleanPdf(cleanedBlob, originalInput = []) {
  const origList = Array.isArray(originalInput) ? originalInput : (originalInput?.metadataList || []);
  const totalOriginal = Math.max(0, origList.length);

  try {
    const cleanFile = new File([cleanedBlob], 'cleaned_output.pdf', { type: 'application/pdf' });
    const rescanResult = await scanPdfMetadata(cleanFile);
    const rescanList = rescanResult.metadataList || [];

    const verificationItems = origList.map(item => {
      let removed = false;
      const foundRescanItem = rescanList.find(m => m.key === item.key);

      if (!foundRescanItem) {
        removed = true;
      } else {
        if (item.key === 'producer' && foundRescanItem.value !== item.value) {
          removed = true;
        } else if (item.key === 'creationDate' && foundRescanItem.value !== item.value) {
          removed = true;
        } else if (item.key === 'modificationDate' && foundRescanItem.value !== item.value) {
          removed = true;
        } else {
          removed = false;
        }
      }

      return {
        name: item.name || item.key || 'PDF Field',
        key: item.key || '',
        value: foundRescanItem ? foundRescanItem.value : (item.value || ''),
        isPrivacy: true,
        removed
      };
    });

    const remainingItems = verificationItems.filter(item => !item.removed);
    const removedCount = totalOriginal > 0 ? verificationItems.filter(item => item.removed).length : 0;
    const allSupportedRemoved = remainingItems.length === 0;

    return {
      verified: allSupportedRemoved,
      hasRemaining: remainingItems.length > 0,
      removedCount,
      remainingCount: remainingItems.length,
      totalOriginal,
      verificationItems,
      remainingItems,
      remainingMetadataList: rescanList
    };
  } catch (err) {
    return {
      verified: false,
      hasRemaining: totalOriginal > 0,
      removedCount: 0,
      remainingCount: totalOriginal,
      totalOriginal,
      verificationItems: origList.map(item => ({ name: item.name || item.key, key: item.key, removed: false })),
      remainingMetadataList: origList
    };
  }
}
