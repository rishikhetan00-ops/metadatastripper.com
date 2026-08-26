import fs from 'fs';
import path from 'path';

// Script to inspect MP4 / MOV binary atoms and test FFmpeg metadata extraction
async function diagnose() {
  console.log('--- Video Metadata Scanner Diagnosis ---');

  // Create a metadata-rich sample MP4 using Node or inspect ISOBMFF structure
  const testFile = 'scratch/test_video.mp4';
  if (fs.existsSync(testFile)) {
    const buf = fs.readFileSync(testFile);
    console.log(`Test File Read: ${testFile} (${buf.length} bytes)`);
  } else {
    console.log('No local sample video file found in scratch directory yet.');
  }
}

diagnose();
