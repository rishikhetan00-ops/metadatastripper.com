import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import fs from 'fs';

async function testFFmpegLog() {
  console.log('Loading FFmpeg WASM in Node...');
  const ffmpeg = new FFmpeg();
  
  let rawLogs = '';
  ffmpeg.on('log', ({ message }) => {
    rawLogs += message + '\n';
  });

  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm')
  });

  console.log('FFmpeg WASM Loaded successfully!');

  // Create a sample MP4 with embedded metadata using FFmpeg canvas/lavfi generator
  // -metadata title="iPhone Video Test" -metadata location="+37.7749-122.4194/" -metadata make="Apple" -metadata model="iPhone 14 Pro" -metadata creation_time="2023-08-15T14:30:00Z"
  console.log('Generating test MP4 with metadata...');
  await ffmpeg.exec([
    '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=2',
    '-metadata', 'title=iPhone Sample Recording',
    '-metadata', 'artist=John Doe',
    '-metadata', 'location=+37.7749-122.4194/',
    '-metadata', 'location-eng=+37.7749-122.4194/',
    '-metadata', 'com.apple.quicktime.make=Apple',
    '-metadata', 'com.apple.quicktime.model=iPhone 14 Pro',
    '-metadata', 'com.apple.quicktime.software=iOS 16.5',
    '-metadata', 'com.apple.quicktime.creationdate=2023-08-15T14:30:00Z',
    '-metadata', 'creation_time=2023-08-15T14:30:00Z',
    '-metadata', 'encoder=CapCut 12.0',
    '-metadata', 'copyright=Copyright 2023',
    '-metadata', 'comment=Private recording',
    '-c:v', 'libx264', '-c:a', 'aac',
    'metadata_rich.mp4'
  ]);

  console.log('--- Generating Raw FFmpeg Output Log ---');
  rawLogs = ''; // Reset log
  await ffmpeg.exec(['-i', 'metadata_rich.mp4']);
  
  console.log('=== RAW FFMPEG OUTPUT ===');
  console.log(rawLogs);
  console.log('=========================');

  // Save the sample MP4 for testing
  const data = await ffmpeg.readFile('metadata_rich.mp4');
  fs.writeFileSync('scratch/metadata_rich.mp4', Buffer.from(data.buffer));
  console.log('Saved scratch/metadata_rich.mp4 for analysis.');
}

testFFmpegLog().catch(console.error);
