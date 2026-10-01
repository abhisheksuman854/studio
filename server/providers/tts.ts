import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { TTSProvider } from './types.js';

const execFileAsync = promisify(execFile);

export class LocalTTSProvider implements TTSProvider {
  async synthesize(text: string, voiceStyle = 'Samantha', outputFile?: string): Promise<{ filePath: string; durationSec: number }> {
    const targetDir = path.resolve('./data/storage/audio');
    fs.mkdirSync(targetDir, { recursive: true });

    const outPath = outputFile || path.join(targetDir, `tts_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp3`);
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    // Standard narration speed: ~135-150 words/min => ~2.3 words/sec. Minimum 3 seconds.
    const estimatedDuration = Math.max(3, Math.ceil(wordCount / 2.3));

    // Try macOS native "say" utility if available
    if (process.platform === 'darwin') {
      try {
        const tempAiff = path.join(targetDir, `temp_${Date.now()}.aiff`);
        // Use high quality macOS voice (Samantha / Daniel / Alex)
        await execFileAsync('say', ['-v', voiceStyle || 'Samantha', '-o', tempAiff, text]);

        // Convert AIFF to MP3 with FFmpeg
        await execFileAsync('ffmpeg', ['-y', '-i', tempAiff, '-codec:a', 'libmp3lame', '-qscale:a', '2', outPath]);
        try { fs.unlinkSync(tempAiff); } catch {}

        // Probe duration using ffprobe
        try {
          const { stdout } = await execFileAsync('ffprobe', [
            '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            outPath,
          ]);
          const probed = parseFloat(stdout.trim());
          if (!isNaN(probed) && probed > 0) {
            return { filePath: outPath, durationSec: Math.round(probed) };
          }
        } catch {
          // If ffprobe is not found, use estimated duration
        }

        return { filePath: outPath, durationSec: estimatedDuration };
      } catch (err) {
        console.warn('Native say command failed, falling back to FFmpeg synthesized track:', err);
      }
    }

    // Fallback: Use FFmpeg lavfi sine wave / noise audio generator for ₹0 environments
    try {
      await execFileAsync('ffmpeg', [
        '-y',
        '-f', 'lavfi',
        '-i', `anoisesrc=d=${estimatedDuration}:c=pink:r=44100:a=0.01`,
        '-c:a', 'libmp3lame',
        outPath,
      ]);
    } catch {
      // If ffmpeg fails, write a basic dummy silence container
      fs.writeFileSync(outPath, Buffer.from([]));
    }

    return { filePath: outPath, durationSec: estimatedDuration };
  }
}
