import fs from 'node:fs';
import path from 'node:path';

export interface NeuralDanceOptions {
  sceneOrder: number;
  durationSec: number;
  portraitPath: string;
  visualPrompt: string;
  outputPath: string;
  gpuServerUrl?: string;
  apiProvider?: 'COLAB_GPU' | 'REPLICATE' | 'FAL_AI' | 'KLING_AI';
  apiKey?: string;
}

export class NeuralDanceProvider {
  /**
   * Dispatches neural video diffusion inference to a GPU backend
   * (Google Colab T4 GPU, Replicate, Fal.ai, or Kling).
   */
  async generateNeuralDanceVideo(options: NeuralDanceOptions): Promise<{ filePath: string; providerUsed: string }> {
    const { durationSec, portraitPath, visualPrompt, outputPath, gpuServerUrl, apiProvider, apiKey } = options;
    const targetDir = path.dirname(outputPath);
    fs.mkdirSync(targetDir, { recursive: true });

    const absPortrait = path.resolve(portraitPath);
    if (!fs.existsSync(absPortrait)) {
      throw new Error(`Source character image not found at ${absPortrait}`);
    }

    const imgBuffer = fs.readFileSync(absPortrait);
    const imgBase64 = `data:image/jpeg;base64,${imgBuffer.toString('base64')}`;

    // 1. If Google Colab / Custom GPU Server is configured
    const serverUrl = gpuServerUrl || process.env.NEURAL_DANCE_GPU_URL;
    if (serverUrl && (apiProvider === 'COLAB_GPU' || !apiProvider)) {
      try {
        const cleanUrl = serverUrl.replace(/\/+$/, '');
        const resp = await fetch(`${cleanUrl}/api/generate-dance`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: imgBase64,
            prompt: visualPrompt || 'Bollywood expressive classical dance in monsoon rain, 8k 9:16 vertical',
            durationSec: Math.min(10, Math.max(3, durationSec || 5)),
            motionPreset: 'bollywood_monsoon',
          }),
        });

        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.detail || `GPU server responded with HTTP ${resp.status}`);
        }

        const data: any = await resp.json();
        if (data.videoBase64) {
          const rawB64 = data.videoBase64.replace(/^data:video\/[a-zA-Z0-9]+;base64,/, '');
          fs.writeFileSync(outputPath, Buffer.from(rawB64, 'base64'));
          return { filePath: outputPath, providerUsed: 'Google Colab T4 GPU (MimicMotion)' };
        }
      } catch (err: any) {
        console.error('Colab GPU server call failed:', err.message);
        throw new Error(`Neural GPU Server Error: ${err.message}. Make sure Colab server is running with ngrok URL.`);
      }
    }

    // 2. If Fal.ai API is configured
    const falKey = apiKey || process.env.FAL_KEY;
    if (apiProvider === 'FAL_AI' && falKey) {
      try {
        const resp = await fetch('https://queue.fal.run/fal-ai/liveportrait', {
          method: 'POST',
          headers: {
            'Authorization': `Key ${falKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            source_image_url: imgBase64,
            driving_video_url: 'https://storage.googleapis.com/falserverless/liveportrait/sample_dance.mp4',
          }),
        });
        const result: any = await resp.json();
        if (result?.video?.url) {
          const vResp = await fetch(result.video.url);
          const buf = await vResp.arrayBuffer();
          fs.writeFileSync(outputPath, Buffer.from(buf));
          return { filePath: outputPath, providerUsed: 'Fal.ai Neural Cloud' };
        }
      } catch (err: any) {
        throw new Error(`Fal.ai API Error: ${err.message}`);
      }
    }

    // 3. If Replicate API is configured (MimicMotion / AnimateAnyone)
    const replicateToken = apiKey || process.env.REPLICATE_API_KEY || process.env.REPLICATE_API_TOKEN;
    if (apiProvider === 'REPLICATE' && replicateToken) {
      try {
        const resp = await fetch('https://api.replicate.com/v1/predictions', {
          method: 'POST',
          headers: {
            'Authorization': `Token ${replicateToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            version: 'tencent/mimicmotion:e09210985223f6631e67e3bf60a816ef10b00dfd3c52e4f0c4dc3c631484050e',
            input: {
              image: imgBase64,
              prompt: visualPrompt,
            },
          }),
        });
        const pred: any = await resp.json();
        if (pred?.urls?.get) {
          // Poll for completion
          let outputUrl: string | null = null;
          for (let i = 0; i < 30; i++) {
            await new Promise((r) => setTimeout(r, 2000));
            const poll = await (await fetch(pred.urls.get, { headers: { 'Authorization': `Token ${replicateToken}` } })).json() as any;
            if (poll.status === 'succeeded' && poll.output) {
              outputUrl = Array.isArray(poll.output) ? poll.output[0] : poll.output;
              break;
            }
            if (poll.status === 'failed') throw new Error(poll.error || 'Replicate prediction failed');
          }
          if (outputUrl) {
            const vResp = await fetch(outputUrl);
            const buf = await vResp.arrayBuffer();
            fs.writeFileSync(outputPath, Buffer.from(buf));
            return { filePath: outputPath, providerUsed: 'Replicate Cloud (MimicMotion)' };
          }
        }
      } catch (err: any) {
        throw new Error(`Replicate API Error: ${err.message}`);
      }
    }

    throw new Error('No Neural GPU backend connected. Please paste your Google Colab URL or API key in Neural Settings.');
  }
}
