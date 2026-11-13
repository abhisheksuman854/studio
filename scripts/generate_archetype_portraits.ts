import { Resvg } from '@resvg/resvg-js';
import fs from 'node:fs';
import path from 'node:path';
import { DANCER_ARCHETYPES } from '../server/content_engine.js';

const storageDir = path.resolve('./data/storage/images');
fs.mkdirSync(storageDir, { recursive: true });

function createDancerSvg(arc: {
  name: string;
  role: string;
  region: string;
  regionFlag: string;
  accentColor: string;
  avatarEmoji: string;
  appearance: string;
  clothingStyle: string;
}) {
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

  return `
<svg width="720" height="960" viewBox="0 0 720 960" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="stageSpotlight" cx="50%" cy="38%" r="65%">
      <stop offset="0%" stop-color="${arc.accentColor}" stop-opacity="0.45" />
      <stop offset="50%" stop-color="#0b1120" stop-opacity="0.8" />
      <stop offset="100%" stop-color="#030712" stop-opacity="1" />
    </radialGradient>

    <linearGradient id="glowBorder" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${arc.accentColor}" stop-opacity="0.9" />
      <stop offset="50%" stop-color="#fbbf24" stop-opacity="0.6" />
      <stop offset="100%" stop-color="${arc.accentColor}" stop-opacity="0.2" />
    </linearGradient>

    <linearGradient id="fadeDown" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#000000" stop-opacity="0.1" />
      <stop offset="60%" stop-color="#000000" stop-opacity="0.3" />
      <stop offset="100%" stop-color="#030712" stop-opacity="0.95" />
    </linearGradient>

    <filter id="shadowGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="8" stdDeviation="16" flood-color="${arc.accentColor}" flood-opacity="0.6" />
    </filter>
  </defs>

  <!-- Deep Stage Base -->
  <rect width="720" height="960" fill="#030712" />
  <rect width="720" height="960" fill="url(#stageSpotlight)" />

  <!-- Outer Luxury Border -->
  <rect x="16" y="16" width="688" height="928" rx="24" fill="none" stroke="url(#glowBorder)" stroke-width="2.5" />

  <!-- Theatrical Backdrop Rings -->
  <circle cx="360" cy="380" r="230" fill="none" stroke="${arc.accentColor}" stroke-width="1.5" stroke-opacity="0.25" stroke-dasharray="8 6" />
  <circle cx="360" cy="380" r="170" fill="none" stroke="#fbbf24" stroke-width="1" stroke-opacity="0.3" />

  <!-- Central Avatar Glow Disc -->
  <circle cx="360" cy="360" r="130" fill="#0f172a" stroke="${arc.accentColor}" stroke-width="3" filter="url(#shadowGlow)" />

  <!-- Dancer Emoji Avatar Icon -->
  <text x="360" y="415" font-size="110" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif">
    ${arc.avatarEmoji}
  </text>

  <!-- Dark Gradient Vignette for bottom text legibility -->
  <rect y="460" width="720" height="500" fill="url(#fadeDown)" />

  <!-- Top Region & Cultural Flag Badge -->
  <g transform="translate(360, 80)">
    <rect x="-180" y="-22" width="360" height="44" rx="22" fill="#0b1120" fill-opacity="0.85" stroke="${arc.accentColor}" stroke-width="1.5" />
    <text x="0" y="6" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="700" fill="#ffffff" text-anchor="middle" letter-spacing="1.5">
      ${arc.regionFlag}  ${escapeXml(arc.region.toUpperCase())}
    </text>
  </g>

  <!-- Stage Title & Persona Identity -->
  <text x="360" y="640" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="28" font-weight="900" fill="#f8fafc" text-anchor="middle" letter-spacing="0.5">
    ${escapeXml(arc.name)}
  </text>

  <!-- Dance Role Subtitle -->
  <text x="360" y="685" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="20" font-weight="700" fill="${arc.accentColor}" text-anchor="middle" letter-spacing="1">
    ${escapeXml(arc.role)}
  </text>

  <!-- Gold Star Accent Line -->
  <g transform="translate(360, 725)">
    <line x1="-120" y1="0" x2="120" y2="0" stroke="#f59e0b" stroke-width="1.5" stroke-opacity="0.6" />
    <circle cx="0" cy="0" r="4" fill="#fbbf24" />
  </g>

  <!-- Visual Feature Pill -->
  <g transform="translate(360, 790)">
    <rect x="-260" y="-30" width="520" height="60" rx="16" fill="#0f172a" fill-opacity="0.9" stroke="rgba(255,255,255,0.12)" stroke-width="1" />
    <text x="0" y="6" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="500" fill="#cbd5e1" text-anchor="middle">
      ✦ LUXURY VIRTUAL DANCER FACE MODEL ✦
    </text>
  </g>

  <!-- Bottom Auravo Studio Watermark -->
  <text x="360" y="895" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="800" fill="#64748b" text-anchor="middle" letter-spacing="3">
    AURAVO STUDIO · 9:16 VERTICAL CHOREOGRAPHY
  </text>
</svg>
  `.trim();
}

console.log('Generating high-resolution luxury dancer archetype portraits...');

for (const arc of DANCER_ARCHETYPES) {
  const filename = path.basename(arc.portraitUrl);
  const outPath = path.join(storageDir, filename);

  const svg = createDancerSvg(arc);
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 720 } });
  const pngBuffer = resvg.render().asPng();
  fs.writeFileSync(outPath, pngBuffer);
  console.log(`  ✓ Generated portrait: ${filename} (${pngBuffer.length} bytes)`);
}

// Also generate rhea_bralette_portrait.jpg as fallback
const rheaSvg = createDancerSvg({
  name: 'Rhea "The Monsoon Siren"',
  role: 'Bollywood Rain Dance Soloist',
  region: 'South Asian / Indo-Western',
  regionFlag: '🇮🇳',
  accentColor: '#f43f5e',
  avatarEmoji: '💃',
  appearance: 'Radiant golden complexion, kohl eyes',
  clothingStyle: 'Embroidered stage corset & silk skirt',
});
const rheaOut = path.join(storageDir, 'rhea_bralette_portrait.jpg');
fs.writeFileSync(rheaOut, new Resvg(rheaSvg, { fitTo: { mode: 'width', value: 720 } }).render().asPng());
console.log('  ✓ Generated fallback: rhea_bralette_portrait.jpg');

console.log('All dancer archetype portraits successfully generated!');
