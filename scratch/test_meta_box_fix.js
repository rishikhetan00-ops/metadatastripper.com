import fs from 'fs';

/**
 * Robust meta Box Handler that auto-detects FullBox (4-byte header) vs Plain Box
 */
export function parseMetaBoxSmart(view, bodyOffset, boxEndOffset) {
  function readFourCC(offset) {
    let str = '';
    for (let i = 0; i < 4; i++) {
      if (offset + i >= view.byteLength) break;
      const b = view.getUint8(offset + i);
      str += String.fromCharCode(b);
    }
    return str;
  }

  const knownMetaChildren = ['hdlr', 'keys', 'ilst', 'xml ', 'bxml', 'dinf', 'pitm', 'ipro', 'iinf'];

  // Check if children start at bodyOffset or bodyOffset + 4
  const fourCCAt0 = readFourCC(bodyOffset + 4);
  const fourCCAt4 = readFourCC(bodyOffset + 8);

  let childrenStart = bodyOffset;
  if (knownMetaChildren.includes(fourCCAt4)) {
    childrenStart = bodyOffset + 4; // FullBox with 4-byte version/flags
  } else if (knownMetaChildren.includes(fourCCAt0)) {
    childrenStart = bodyOffset; // Plain box
  } else {
    // Fallback: check if version byte is 0
    const ver = view.getUint8(bodyOffset);
    if (ver === 0) childrenStart = bodyOffset + 4;
  }

  return childrenStart;
}

console.log('Smart meta box handler created.');
