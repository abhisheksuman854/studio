import fs from 'node:fs';
import path from 'node:path';

export interface NeuralDanceOptions {
  sceneOrder: number;
  durationSec: number;
  portraitPath: string;
  visualPrompt: string;
  outputPath: string;
  gpuServerUrl?: string;
  apiProvider?: 'COLAB_GPU' | 'LOCAL_GPU' | 'KAGGLE_GPU';
  apiKey?: string;
  motionBucketId?: number;
  seed?: number;
  onProgress?: (stage: string, progress: number) => void;
}

export function formatHumanReadableGpuError(status: number, rawText: string, serverUrl?: string): string {
  const text = (rawText || '').trim();
  const isHtml = text.startsWith('<') || text.toLowerCase().includes('<!doctype html') || text.toLowerCase().includes('<html');

  // Cloudflare Error 530 / 1016 (Origin DNS Error / Dead Tunnel)
  if (status === 530 || text.includes('1016') || text.includes('Origin DNS error')) {
    return 'Cloudflare Tunnel Expired (HTTP 530): The Google Colab GPU session has stopped or disconnected. Please re-run your Colab notebook to generate a new live tunnel URL, then paste it in Neural AI GPU Settings.';
  }

  // Cloudflare Error 521 (Web server is down)
  if (status === 521 || text.includes('521') || text.includes('Web server is down')) {
    return 'GPU Server Offline (HTTP 521): The Cloudflare tunnel is reachable, but the Python AI worker script is not responding. Please make sure Cell 2 in Colab is running.';
  }

  // Cloudflare Error 524 / 504 (Gateway Timeout)
  if (status === 504 || status === 524 || text.includes('524') || text.includes('Gateway time-out')) {
    return `GPU Inference Timeout (HTTP ${status}): The neural video generation exceeded timeout limits on the remote worker. Try generating a shorter clip or checking GPU memory.`;
  }

  // 502 Bad Gateway
  if (status === 502 || text.includes('Bad Gateway')) {
    return 'Bad Gateway (HTTP 502): The GPU worker proxy failed to reach the local Python process. Please restart the Colab worker cell.';
  }

  // 404 Not Found
  if (status === 404) {
    return `Endpoint Not Found (HTTP 404): The GPU worker URL (${serverUrl || 'configured URL'}) does not recognize the neural endpoint. Ensure you are running the latest Auravo Studio Colab notebook.`;
  }

  // 401 / 403 Unauthorized
  if (status === 401 || status === 403) {
    return `Authentication Failed (HTTP ${status}): Incorrect or missing AI Worker Secret key. Please verify your API key in Neural Settings.`;
  }

  // Generic HTML error page: parse title or strip tags
  if (isHtml) {
    const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';
    const cleanTitle = title.replace(/\s*\|\s*Cloudflare.*/i, '').trim();
    return `GPU Server Error (HTTP ${status}): ${cleanTitle || 'Remote server returned an HTML error page'}. Please verify your Colab / GPU worker status.`;
  }

  // Clean short text error or JSON
  try {
    const parsed = JSON.parse(text);
    if (parsed.error || parsed.message || parsed.detail) {
      return `GPU Worker Error: ${parsed.error || parsed.message || parsed.detail}`;
    }
  } catch {}

  const cleanSnippet = text.length > 200 ? text.slice(0, 197) + '...' : text;
  return `GPU Worker Error (HTTP ${status}): ${cleanSnippet || 'Worker rejected request'}`;
}

export class NeuralDanceProvider {
  /**
   * Dispatches neural video diffusion inference to the Python AI Worker
   * (Google Colab / Kaggle T4 GPU or local GPU).
   * Supports asynchronous binary streaming with zero Base64 overhead.
   */
  async generateNeuralDanceVideo(options: NeuralDanceOptions): Promise<{ filePath: string; providerUsed: string }> {
    const { durationSec, portraitPath, visualPrompt, outputPath, gpuServerUrl, apiKey, onProgress } = options;
    const targetDir = path.dirname(outputPath);
    fs.mkdirSync(targetDir, { recursive: true });

    const absPortrait = path.resolve(portraitPath);
    if (!fs.existsSync(absPortrait)) {
      throw new Error(`Source character image not found at ${absPortrait}`);
    }

    const serverUrl = gpuServerUrl || process.env.NEURAL_DANCE_GPU_URL;
    if (!serverUrl) {
      throw new Error('No Neural GPU backend connected. Please paste your Google Colab / Kaggle URL in Neural Settings.');
    }

    const cleanUrl = serverUrl.replace(/\/+$/, '');
    const headers: Record<string, string> = {};
    const token = apiKey || process.env.AI_WORKER_SECRET;
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const fileBytes = fs.readFileSync(absPortrait);
    const mime = absPortrait.endsWith('.png') ? 'image/png' : 'image/jpeg';
    const blob = new Blob([fileBytes], { type: mime });
    const formData = new FormData();
    const motionPresets: Record<number, number> = {
      1: 125, // Beat 1: Intro hook - focused eye-line gaze & subtle body breathing
      2: 165, // Beat 2: Mudra & torso flow - graceful arm/hand mudra waves
      3: 195, // Beat 3: Dramatic climax - full spin & rapid cloth swirl
      4: 150, // Beat 4: Monsoon freeze - sculpted freeze-frame arch
      5: 135, // Beat 5: Sensual sign-off - graceful bow and head turn
    };
    const motionBucket = options.motionBucketId || motionPresets[options.sceneOrder || 1] || 150;
    const dynamicSeed = options.seed !== undefined ? options.seed : (Math.floor(Date.now() * 1000) % 2147483647);

    formData.append('image', blob, path.basename(absPortrait));
    formData.append('prompt', visualPrompt || 'Bollywood expressive classical dance in monsoon rain, 8k 9:16 vertical');
    formData.append('durationSec', String(Math.min(10, Math.max(3, durationSec || 5))));
    formData.append('sceneOrder', String(options.sceneOrder || 1));
    formData.append('motionBucketId', String(motionBucket));
    formData.append('seed', String(dynamicSeed));

    let submitResp: Response;
    try {
      submitResp = await fetch(`${cleanUrl}/api/jobs/dance`, {
        method: 'POST',
        headers,
        body: formData,
      });
    } catch (netErr: any) {
      throw new Error(`Could not connect to GPU worker at ${cleanUrl}: ${netErr.message || 'Network unreachable'}. Is Google Colab running?`);
    }

    if (!submitResp.ok) {
      const errText = await submitResp.text().catch(() => '');
      throw new Error(formatHumanReadableGpuError(submitResp.status, errText, cleanUrl));
    }

    const jobData = (await submitResp.json()) as { ok: boolean; jobId: string; pollUrl: string };
    const jobId = jobData.jobId;

    // Poll for asynchronous completion with progressive timeout (up to 8 minutes)
    const maxWaitMs = 480_000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      await new Promise((r) => setTimeout(r, 2000));
      let statusResp: Response;
      try {
        statusResp = await fetch(`${cleanUrl}/api/jobs/${jobId}`, { headers });
      } catch {
        continue;
      }
      if (!statusResp.ok) continue;

      const statusData = (await statusResp.json()) as {
        status: string;
        progress?: number;
        currentStage?: string;
        error?: string;
      };

      if (onProgress && statusData.progress !== undefined) {
        onProgress(statusData.currentStage || statusData.status, statusData.progress);
      }

      if (statusData.status === 'COMPLETED') {
        // Stream binary video directly to output file
        const streamResp = await fetch(`${cleanUrl}/api/jobs/${jobId}/video.mp4`, { headers });
        if (!streamResp.ok) throw new Error(`Failed to download rendered video stream: HTTP ${streamResp.status}`);

        const arrayBuf = await streamResp.arrayBuffer();
        fs.writeFileSync(outputPath, Buffer.from(arrayBuf));
        return { filePath: outputPath, providerUsed: 'Auravo Python AI Worker (Binary Stream)' };
      }

      if (statusData.status === 'FAILED') {
        throw new Error(`GPU Worker Task Failed: ${statusData.error || 'Neural worker reported task failure'}`);
      }
    }

    throw new Error('Diffusion generation timed out after 8 minutes');
  }
}
