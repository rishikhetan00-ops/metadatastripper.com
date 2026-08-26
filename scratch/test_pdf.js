import { PDFDocument, PDFName } from 'pdf-lib';

async function test() {
  // Create sample PDF with metadata
  const doc = await PDFDocument.create();
  doc.addPage([600, 400]);
  doc.setTitle('Test Document');
  doc.setAuthor('Jane Doe');
  doc.setProducer('Custom PDF Printer');
  doc.setCreationDate(new Date('2023-05-15'));
  doc.setModificationDate(new Date('2023-06-20'));

  const initialBytes = await doc.save();

  // Load and inspect initial metadata
  const docLoaded = await PDFDocument.load(initialBytes);
  console.log('--- Initial Metadata ---');
  console.log('Title:', docLoaded.getTitle());
  console.log('Author:', docLoaded.getAuthor());
  console.log('Producer:', docLoaded.getProducer());
  console.log('CreationDate:', docLoaded.getCreationDate());
  console.log('ModDate:', docLoaded.getModificationDate());

  // Delete info dict keys directly
  const infoDictRef = docLoaded.context.trailerInfo.Info;
  if (infoDictRef) {
    const infoDict = docLoaded.context.lookup(infoDictRef);
    if (infoDict) {
      infoDict.delete(PDFName.of('Title'));
      infoDict.delete(PDFName.of('Author'));
      infoDict.delete(PDFName.of('Subject'));
      infoDict.delete(PDFName.of('Keywords'));
      infoDict.delete(PDFName.of('Creator'));
      infoDict.delete(PDFName.of('Producer'));
      infoDict.delete(PDFName.of('CreationDate'));
      infoDict.delete(PDFName.of('ModDate'));
    }
  }

  // Save with updateInfoDict: false
  const cleanBytes = await docLoaded.save({ updateInfoDict: false });

  // Rescan cleaned PDF
  const docCleaned = await PDFDocument.load(cleanBytes);
  console.log('--- Cleaned Metadata ---');
  console.log('Title:', docCleaned.getTitle());
  console.log('Author:', docCleaned.getAuthor());
  console.log('Producer:', docCleaned.getProducer());
  console.log('CreationDate:', docCleaned.getCreationDate());
  console.log('ModDate:', docCleaned.getModificationDate());
}

test().catch(console.error);
