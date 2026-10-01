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
    <!-- Full-Bleed 1080x1920 Photorealistic Dancer Visual -->
    <image href="${resolvedPortraitDataUri}" x="0" y="0" width="1080" height="1920" preserveAspectRatio="xMidYMid slice" />
  ` : `
    <!-- Fallback Theatrical Gradient Canvas -->
    <rect width="1080" height="1920" fill="#090d16" />
    <circle cx="540" cy="800" r="450" fill="url(#stageGlow)" />
  `}

  <!-- Atmospheric Lighting & Dark Cinematic Vignettes -->
  <rect width="1080" height="500" fill="url(#topVignette)" />
  <rect y="1000" width="1080" height="920" fill="url(#bottomVignette)" />

  <!-- Theatrical Rim Highlight Border -->
  <rect x="20" y="20" width="1040" height="1880" rx="36" fill="none" stroke="url(#goldGrad)" stroke-width="2" stroke-opacity="0.4" />

  <!-- Top Floating Glassmorphism Brand Badge -->
  <g transform="translate(540, 110)">
    <rect x="-240" y="-30" width="480" height="60" rx="30" fill="#0a0f1d" fill-opacity="0.85" stroke="#f59e0b" stroke-width="1.5" filter="url(#glowFilter)" />
    <text x="0" y="8" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="20" font-weight="800" fill="#fbbf24" text-anchor="middle" letter-spacing="4">
      ✦ AURAVO STUDIO · ${escapeXml(overlayText)}
    </text>
  </g>

  <!-- Bottom Native Reels / Shorts Subtitle Overlay -->
  ${narrationLines.length > 0 ? `
    <g transform="translate(60, 1540)">
      <rect width="960" height="${Math.max(160, narrationLines.length * 56 + 50)}" rx="28" fill="#030712" fill-opacity="0.88" stroke="#f59e0b" stroke-width="2" stroke-opacity="0.75" />
      <rect x="40" y="22" width="140" height="28" rx="14" fill="url(#accentPill)" />
      <text x="110" y="41" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="900" fill="#ffffff" text-anchor="middle" letter-spacing="2">
        NARRATION
      </text>
      ${narrationLines.map((line, idx) => `
        <text x="40" y="${88 + idx * 52}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="32" font-weight="700" fill="#ffffff">
          "${escapeXml(line)}"
        </text>
      `).join('')}
    </g>
  ` : ''}

  <!-- Bottom Floating Audio Wave Indicator -->
  <g transform="translate(540, 1850)">
    <rect x="-140" y="-18" width="280" height="36" rx="18" fill="#1e293b" fill-opacity="0.9" />
    <text x="0" y="5" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="700" fill="#94a3b8" text-anchor="middle" letter-spacing="3">
      1080×1920 • 9:16 VERTICAL
    </text>
  </g>
</svg>
    `.trim();

    const resvg = new Resvg(svgContent, { fitTo: { mode: 'width', value: 1080 } });
    const pngBuffer = resvg.render().asPng();
    fs.writeFileSync(outPath, pngBuffer);

    return { filePath: outPath };
  }
}
