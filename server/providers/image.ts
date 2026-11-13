import { Resvg } from '@resvg/resvg-js';
import fs from 'node:fs';
import path from 'node:path';
import type { ImageProvider } from './types.js';

export class LocalImageProvider implements ImageProvider {
  async generateSceneImage(
    prompt: string,
    style = 'cinematic',
    outputFile?: string,
    overlayText = 'SCENE BEAT',
    narration = '',
    characterPortraitPath?: string
  ): Promise<{ filePath: string }> {
    const targetDir = path.resolve('./data/storage/images');
    fs.mkdirSync(targetDir, { recursive: true });

    const outPath = outputFile || path.join(targetDir, `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`);

    const escapeXml = (str: string) =>
      (str || '').replace(/[<>&'"]/g, (c) => {
        switch (c) {
          case '<': return '&lt;';
          case '>': return '&gt;';
          case '&': return '&amp;';
          case '\'': return '&apos;';
          case '"': return '&quot;';
          default: return c;
        }
      });

    // Determine portrait image to embed
    let resolvedPortraitDataUri = '';
    const candidates = [
      characterPortraitPath,
      ...(prompt.toLowerCase().includes('bralette') || prompt.toLowerCase().includes('backless') || prompt.toLowerCase().includes('rhea')
        ? [path.join(targetDir, 'rhea_bralette_portrait.jpg'), path.join(targetDir, 'rhea_backless_portrait.jpg'), path.join(targetDir, 'monsoon_rain_portrait.jpg')]
        : []),
      ...(prompt.toLowerCase().includes('priya') ? [path.join(targetDir, 'priya_portrait.jpg')] : []),
      ...(prompt.toLowerCase().includes('elena') ? [path.join(targetDir, 'elena_portrait.jpg')] : []),
      ...(prompt.toLowerCase().includes('mei') ? [path.join(targetDir, 'mei_portrait.jpg')] : []),
      ...(prompt.toLowerCase().includes('maya') ? [path.join(targetDir, 'maya_portrait.jpg')] : []),
      ...(prompt.toLowerCase().includes('aria') ? [path.join(targetDir, 'aria_portrait.jpg')] : []),
      ...(prompt.toLowerCase().includes('amara') ? [path.join(targetDir, 'amara_portrait.jpg')] : []),
      ...(prompt.toLowerCase().includes('zara') ? [path.join(targetDir, 'zara_portrait.jpg')] : []),
      path.join(targetDir, 'rhea_bralette_portrait.jpg'),
      path.join(targetDir, 'priya_portrait.jpg'),
      path.join(targetDir, 'monsoon_rain_portrait.jpg')
    ].filter(Boolean) as string[];

    for (const cand of candidates) {
      if (fs.existsSync(cand)) {
        try {
          const buf = fs.readFileSync(cand);
          const mime = cand.endsWith('.png') ? 'image/png' : 'image/jpeg';
          resolvedPortraitDataUri = `data:${mime};base64,${buf.toString('base64')}`;
          break;
        } catch {
          // ignore and try next
        }
      }
    }

    // Word wrap helper for SVG text
    const wrapText = (text: string, maxCharsPerLine = 34): string[] => {
      const words = text.split(/\s+/);
      const lines: string[] = [];
      let currentLine = '';

      for (const w of words) {
        if ((currentLine + ' ' + w).trim().length <= maxCharsPerLine) {
          currentLine = (currentLine + ' ' + w).trim();
        } else {
          if (currentLine) lines.push(currentLine);
          currentLine = w;
        }
      }
      if (currentLine) lines.push(currentLine);
      return lines;
    };

    const narrationLines = wrapText(narration || prompt, 32).slice(0, 4);
    const promptLines = wrapText(prompt, 38).slice(0, 5);

    const svgContent = `
<svg width="1080" height="1920" viewBox="0 0 1080 1920" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="topVignette" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#000000" stop-opacity="0.8" />
      <stop offset="25%" stop-color="#000000" stop-opacity="0.2" />
      <stop offset="100%" stop-color="#000000" stop-opacity="0" />
    </linearGradient>

    <linearGradient id="bottomVignette" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#000000" stop-opacity="0" />
      <stop offset="40%" stop-color="#000000" stop-opacity="0.4" />
      <stop offset="80%" stop-color="#000000" stop-opacity="0.85" />
      <stop offset="100%" stop-color="#030712" stop-opacity="0.96" />
    </linearGradient>

    <radialGradient id="stageGlow" cx="50%" cy="50%" r="60%">
      <stop offset="0%" stop-color="#f59e0b" stop-opacity="0.25" />
      <stop offset="60%" stop-color="#6366f1" stop-opacity="0.1" />
      <stop offset="100%" stop-color="#000000" stop-opacity="0" />
    </radialGradient>

    <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#fbbf24" />
      <stop offset="100%" stop-color="#f59e0b" />
    </linearGradient>

    <linearGradient id="accentPill" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#f59e0b" />
      <stop offset="100%" stop-color="#ef4444" />
    </linearGradient>

    <filter id="glowFilter" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="8" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
  </defs>

  <!-- Deep Stage Background Fill -->
  <rect width="1080" height="1920" fill="#070b14" />

  ${resolvedPortraitDataUri ? `
    <!-- Full-Bleed 1080x1920 Photorealistic Dancer Visual (Zero baked-in text or borders) -->
    <image href="${resolvedPortraitDataUri}" x="0" y="0" width="1080" height="1920" preserveAspectRatio="xMidYMid slice" />
  ` : `
    <!-- Theatrical Stage Atmosphere -->
    <rect width="1080" height="1920" fill="#090d16" />
    <circle cx="540" cy="800" r="450" fill="url(#stageGlow)" />
  `}

  <!-- Subtle Atmospheric Lighting Vignettes for Cinematic Mood -->
  <rect width="1080" height="300" fill="url(#topVignette)" opacity="0.4" />
  <rect y="1620" width="1080" height="300" fill="url(#bottomVignette)" opacity="0.5" />
</svg>
    `.trim();

    const resvg = new Resvg(svgContent, { fitTo: { mode: 'width', value: 1080 } });
    const pngBuffer = resvg.render().asPng();
    fs.writeFileSync(outPath, pngBuffer);

    return { filePath: outPath };
  }
}
