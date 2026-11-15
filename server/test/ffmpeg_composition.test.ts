import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FFmpegVideoProvider } from '../providers/video.js';

const execFileAsync = promisify(execFile);

test('Workstream C & D: FFmpeg Composition Regression & Output Integrity', async () => {
  const provider = new FFmpegVideoProvider();

  // Create isolated temporary directory for test fixtures
  const tempDir = path.resolve(`./data/storage/temp_ffmpeg_test_${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const testImagePath = path.join(tempDir, 'fixture_scene.png');
  const testAudioPath = path.join(tempDir, 'fixture_narration.aac');
  const testMusicPath = path.join(tempDir, 'fixture_music.aac');
  const outputVideoPath1 = path.join(tempDir, 'master_output_run1.mp4');
  const outputVideoPath2 = path.join(tempDir, 'master_output_run2.mp4');
  const testSrtPath = path.join(tempDir, 'fixture_subtitles.srt');

  try {
    // 1. Generate synthetic local fixtures with FFmpeg (lavfi color and sine wave generators - 0 copyrighted media)
    await execFileAsync('ffmpeg', [
      '-y',
      '-f', 'lavfi',
      '-i', 'color=c=indigo:s=1080x1920:d=1',
      '-vframes', '1',
      testImagePath,
    ]);

    await execFileAsync('ffmpeg', [
      '-y',
      '-f', 'lavfi',
      '-i', 'sine=frequency=440:duration=2',
      '-c:a', 'aac',
      testAudioPath,
    ]);

    await execFileAsync('ffmpeg', [
      '-y',
      '-f', 'lavfi',
      '-i', 'sine=frequency=220:duration=3',
      '-c:a', 'aac',
      testMusicPath,
    ]);

    fs.writeFileSync(testSrtPath, '1\n00:00:00,000 --> 00:00:02,000\nAuravo Composition Test\n', 'utf8');

    assert.ok(fs.existsSync(testImagePath), 'Test scene image fixture must exist');
    assert.ok(fs.existsSync(testAudioPath), 'Test audio fixture must exist');
    assert.ok(fs.existsSync(testMusicPath), 'Test music fixture must exist');

    // 2. Test Successful Composition: Dimensions, Framerate, Codec & Non-Zero File Size
    const renderResult1 = await provider.renderShort({
      scenes: [
        { imagePath: testImagePath, narration: 'Beat 1: Entrance posture', durationSec: 1 },
        { imagePath: testImagePath, narration: 'Beat 2: Rhythmic cadence', durationSec: 1 },
      ],
      audioTrackPath: testAudioPath,
      musicTrackPath: testMusicPath,
      audioMode: 'narration_and_music',
      subtitlesSrtPath: testSrtPath,
      outputPath: outputVideoPath1,
      title: 'FFmpeg Test Composition Run 1',
    });

    assert.equal(renderResult1.filePath, outputVideoPath1);
    assert.equal(renderResult1.durationSec, 2);
    assert.ok(fs.existsSync(outputVideoPath1));
    const stats1 = fs.statSync(outputVideoPath1);
    assert.ok(stats1.size > 5000, `Output video should be valid non-zero size, got ${stats1.size} bytes`);

    // Probe video properties with ffprobe
    const { stdout: probeStdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,codec_name,r_frame_rate',
      '-of', 'json',
      outputVideoPath1,
    ]);
    const probeData = JSON.parse(probeStdout);
    const videoStream = probeData.streams[0];
    assert.equal(videoStream.width, 1080, 'Output video width must be exactly 1080 (portrait 9:16)');
    assert.equal(videoStream.height, 1920, 'Output video height must be exactly 1920 (portrait 9:16)');
    assert.equal(videoStream.codec_name, 'h264', 'Output video codec must be H.264');
    assert.equal(videoStream.r_frame_rate, '30/1', 'Output video frame rate must be normalized to 30 fps');

    // Probe audio properties
    const { stdout: audioProbeStdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-select_streams', 'a:0',
      '-show_entries', 'stream=codec_name,channels',
      '-of', 'json',
      outputVideoPath1,
    ]);
    const audioProbeData = JSON.parse(audioProbeStdout);
    assert.ok(audioProbeData.streams.length > 0, 'Output video must contain mixed AAC audio stream');
    assert.equal(audioProbeData.streams[0].codec_name, 'aac', 'Audio stream must be AAC');

    // 3. Test Repeated Rendering without Stale Intermediate Contamination
    const renderResult2 = await provider.renderShort({
      scenes: [
        { imagePath: testImagePath, narration: 'Beat 1: Single beat', durationSec: 1 },
      ],
      audioTrackPath: testAudioPath,
      musicTrackPath: testMusicPath,
      audioMode: 'music_only',
      subtitlesSrtPath: testSrtPath,
      outputPath: outputVideoPath2,
      title: 'FFmpeg Test Composition Run 2',
    });

    assert.equal(renderResult2.filePath, outputVideoPath2);
    assert.ok(fs.existsSync(outputVideoPath2));
    assert.ok(fs.statSync(outputVideoPath2).size > 3000);

    // 4. Test Temporary-File Cleanup
    // Verify target video directory contains no leftover concat_*.txt or temp_motion_*.mp4 files
    const storageVideosDir = path.resolve('./data/storage/videos');
    if (fs.existsSync(storageVideosDir)) {
      const leftoverFiles = fs.readdirSync(storageVideosDir).filter(
        (f) => f.startsWith('concat_') || f.startsWith('temp_motion_')
      );
      assert.equal(
        leftoverFiles.length,
        0,
        `Expected 0 temporary files remaining in storage/videos, found: ${leftoverFiles.join(', ')}`
      );
    }

    // 5. Test Missing / Invalid Input Handling & Error Propagation
    // Case A: Empty scenes array
    await assert.rejects(
      async () => {
        await provider.renderShort({
          scenes: [],
          audioTrackPath: testAudioPath,
          subtitlesSrtPath: testSrtPath,
          outputPath: path.join(tempDir, 'should_fail.mp4'),
        });
      },
      /Video rendering failed: Scene list is empty/,
      'Compositor must reject empty scenes array with descriptive error'
    );

    // Case B: Non-existent image/video file path
    await assert.rejects(
      async () => {
        await provider.renderShort({
          scenes: [{ imagePath: '/nonexistent/image.png', narration: 'ghost', durationSec: 2 }],
          audioTrackPath: testAudioPath,
          subtitlesSrtPath: testSrtPath,
          outputPath: path.join(tempDir, 'should_fail_missing_file.mp4'),
        });
      },
      /Video rendering failed: No valid scene images or video clips found on disk to render/,
      'Compositor must reject missing scene files with descriptive error'
    );
  } finally {
    // Cleanup temporary test fixtures directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

