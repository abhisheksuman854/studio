import { Resvg } from '@resvg/resvg-js';
import fs from 'node:fs';
import path from 'node:path';

export function createAriaDevSvg(width = 768, height = 1024): string {
  return `
<svg width="${width}" height="${height}" viewBox="0 0 768 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- Background Gradients -->
    <radialGradient id="stageGlow" cx="50%" cy="40%" r="60%">
      <stop offset="0%" stop-color="#1e293b" stop-opacity="0.8" />
      <stop offset="45%" stop-color="#0f172a" stop-opacity="0.95" />
      <stop offset="100%" stop-color="#020617" stop-opacity="1" />
    </radialGradient>
    <radialGradient id="blueAtmosphere" cx="50%" cy="30%" r="50%">
      <stop offset="0%" stop-color="#1d4ed8" stop-opacity="0.25" />
      <stop offset="70%" stop-color="#0f172a" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="warmLight" x1="20%" y1="0%" x2="80%" y2="100%">
      <stop offset="0%" stop-color="#fef08a" stop-opacity="0.15" />
      <stop offset="100%" stop-color="#000000" stop-opacity="0" />
    </linearGradient>

    <!-- Skin Shading Gradients -->
    <linearGradient id="skinFace" x1="30%" y1="10%" x2="70%" y2="90%">
      <stop offset="0%" stop-color="#f5caa0" />
      <stop offset="40%" stop-color="#e2ab77" />
      <stop offset="80%" stop-color="#c98a56" />
      <stop offset="100%" stop-color="#ab6b3a" />
    </linearGradient>
    <radialGradient id="cheekBlushL" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#e17055" stop-opacity="0.35" />
      <stop offset="100%" stop-color="#e17055" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="cheekBlushR" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#e17055" stop-opacity="0.35" />
      <stop offset="100%" stop-color="#e17055" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="skinNeck" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#b87645" />
      <stop offset="50%" stop-color="#c98a56" />
      <stop offset="100%" stop-color="#e2ab77" />
    </linearGradient>
    <linearGradient id="skinArm" x1="10%" y1="0%" x2="90%" y2="100%">
      <stop offset="0%" stop-color="#f5caa0" />
      <stop offset="50%" stop-color="#e2ab77" />
      <stop offset="100%" stop-color="#ba7a48" />
    </linearGradient>

    <!-- Hair Gradients -->
    <linearGradient id="hairBase" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#2d1b14" />
      <stop offset="40%" stop-color="#190e0a" />
      <stop offset="100%" stop-color="#0c0705" />
    </linearGradient>
    <linearGradient id="hairHighlight" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#6e4530" stop-opacity="0.7" />
      <stop offset="50%" stop-color="#45271a" stop-opacity="0.5" />
      <stop offset="100%" stop-color="#190e0a" stop-opacity="0" />
    </linearGradient>

    <!-- Gown Gradients -->
    <linearGradient id="sapphireGown" x1="20%" y1="0%" x2="80%" y2="100%">
      <stop offset="0%" stop-color="#1e40af" />
      <stop offset="30%" stop-color="#1d4ed8" />
      <stop offset="70%" stop-color="#0f2b6e" />
      <stop offset="100%" stop-color="#081638" />
    </linearGradient>
    <linearGradient id="silkSheen" x1="0%" y1="0%" x2="100%" y2="50%">
      <stop offset="0%" stop-color="#60a5fa" stop-opacity="0.4" />
      <stop offset="50%" stop-color="#3b82f6" stop-opacity="0.1" />
      <stop offset="100%" stop-color="#1e3a8a" stop-opacity="0" />
    </linearGradient>
    <linearGradient id="goldJewelry" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fde047" />
      <stop offset="50%" stop-color="#d97706" />
      <stop offset="100%" stop-color="#78350f" />
    </linearGradient>

    <!-- Hazel Eye Radial Gradients -->
    <radialGradient id="hazelIris" cx="45%" cy="45%" r="55%">
      <stop offset="0%" stop-color="#84cc16" />
      <stop offset="50%" stop-color="#a16207" />
      <stop offset="85%" stop-color="#4d3003" />
      <stop offset="100%" stop-color="#1c1201" />
    </radialGradient>
  </defs>

  <!-- Clean Studio Stage Backdrop -->
  <rect width="768" height="1024" fill="url(#stageGlow)" />
  <rect width="768" height="1024" fill="url(#blueAtmosphere)" />
  <rect width="768" height="1024" fill="url(#warmLight)" />

  <!-- Soft Ambient Backlight Rim for Depth -->
  <ellipse cx="384" cy="450" rx="280" ry="380" fill="#2563eb" opacity="0.08" />

  <!-- Back Hair (Behind Shoulders and Neck) -->
  <path d="M 270 280 C 210 320 180 430 190 580 C 195 640 230 720 270 760 C 260 700 245 610 250 510 C 255 430 280 340 310 290 Z" fill="url(#hairBase)" />
  <path d="M 498 280 C 558 320 588 430 578 580 C 573 640 538 720 498 760 C 508 700 523 610 518 510 C 513 430 488 340 458 290 Z" fill="url(#hairBase)" />
  <path d="M 290 240 C 240 260 210 320 220 420 C 230 520 250 630 270 700 C 255 580 250 460 255 360 C 260 300 275 260 290 240 Z" fill="#130b08" />

  <!-- Neck and Clavicle -->
  <path d="M 334 370 L 334 470 C 334 495 350 515 384 518 C 418 515 434 495 434 470 L 434 370 Z" fill="url(#skinNeck)" />
  <!-- Throat shadow and collarbone detail -->
  <path d="M 350 490 C 370 502 398 502 418 490 C 400 498 368 498 350 490 Z" stroke="#a05d2c" stroke-width="2.5" fill="none" opacity="0.6" />
  <path d="M 310 515 C 345 528 375 525 384 518 C 393 525 423 528 458 515" stroke="#a05d2c" stroke-width="2" fill="none" opacity="0.5" />

  <!-- Shoulders and Upper Body Base -->
  <path d="M 230 535 C 265 500 320 485 384 485 C 448 485 503 500 538 535 C 575 580 580 660 580 720 L 188 720 C 188 660 193 580 230 535 Z" fill="url(#skinFace)" />

  <!-- Left Arm (Resting gracefully at side) -->
  <path d="M 230 535 C 205 565 190 620 185 690 C 180 760 185 840 195 900 C 210 905 230 900 235 885 C 230 830 225 760 230 700 C 235 650 250 600 270 565 Z" fill="url(#skinArm)" />

  <!-- Midnight Sapphire Silk Gown (Bodice and Torso) -->
  <path d="M 245 570 C 280 625 340 645 384 645 C 428 645 488 625 523 570 C 538 640 545 740 550 850 C 555 930 560 1024 560 1024 L 208 1024 C 208 1024 213 930 218 850 C 223 740 230 640 245 570 Z" fill="url(#sapphireGown)" />
  <!-- Silk Folds and Sheen Highlights -->
  <path d="M 270 590 C 310 655 350 780 345 920 C 343 960 340 1024 340 1024" stroke="url(#silkSheen)" stroke-width="8" fill="none" opacity="0.55" />
  <path d="M 498 590 C 458 655 418 780 423 920 C 425 960 428 1024 428 1024" stroke="url(#silkSheen)" stroke-width="8" fill="none" opacity="0.45" />
  <path d="M 330 640 C 365 655 403 655 438 640 C 410 660 358 660 330 640 Z" fill="#0b1b45" />
  <!-- Gown Neckline Embroidery & Trim -->
  <path d="M 265 560 C 300 595 350 610 384 610 C 418 610 468 595 503 560" stroke="url(#goldJewelry)" stroke-width="3" fill="none" />
  <circle cx="384" cy="610" r="6" fill="#3b82f6" stroke="#fbbf24" stroke-width="1.5" />

  <!-- Right Arm (Articulated Waving Arm in Graceful Dancer Pose) -->
  <!-- Right Shoulder & Bicep -->
  <path d="M 525 520 C 555 500 590 480 625 460 C 642 450 652 462 642 478 C 615 510 580 545 540 575 Z" fill="url(#skinArm)" />
  <!-- Right Forearm extending upward into wave position -->
  <path d="M 625 460 C 638 410 648 355 650 310 C 652 295 670 295 672 312 C 670 365 655 430 638 475 Z" fill="url(#skinArm)" />
  <!-- Gold Dancer Bangle on Right Wrist -->
  <ellipse cx="661" cy="315" rx="14" ry="6" fill="url(#goldJewelry)" transform="rotate(-15 661 315)" />
  <!-- Hand & Articulated Waving Fingers (Open Graceful Palm facing forward) -->
  <path d="M 650 310 C 648 290 646 270 646 250 C 646 242 654 242 655 250 L 658 285" stroke="url(#skinArm)" stroke-width="5" stroke-linecap="round" fill="none" /> <!-- Pinky -->
  <path d="M 656 295 C 655 270 656 245 658 228 C 659 220 667 220 668 228 L 668 285" stroke="url(#skinArm)" stroke-width="5.5" stroke-linecap="round" fill="none" /> <!-- Ring -->
  <path d="M 665 295 C 666 265 668 235 670 218 C 671 210 679 210 680 218 L 678 285" stroke="url(#skinArm)" stroke-width="5.5" stroke-linecap="round" fill="none" /> <!-- Middle -->
  <path d="M 672 300 C 675 275 678 250 681 232 C 682 224 690 224 690 232 L 685 290" stroke="url(#skinArm)" stroke-width="5" stroke-linecap="round" fill="none" /> <!-- Index -->
  <path d="M 672 315 C 685 305 698 290 705 278 C 710 270 716 275 712 284 C 702 300 688 320 675 330 Z" fill="url(#skinArm)" /> <!-- Thumb -->
  <path d="M 652 310 C 650 285 655 265 675 265 C 690 265 695 285 680 325 Z" fill="url(#skinArm)" /> <!-- Palm Body -->

  <!-- Head Base Contour (Sculpted high cheekbones & elegant jaw) -->
  <path d="M 314 260 C 314 180 345 140 384 140 C 423 140 454 180 454 260 C 454 320 442 355 418 385 C 398 410 370 410 350 385 C 326 355 314 320 314 260 Z" fill="url(#skinFace)" />

  <!-- Cheekbone Sculpting & Natural Warm Blush -->
  <ellipse cx="340" cy="305" rx="28" ry="18" fill="url(#cheekBlushL)" />
  <ellipse cx="428" cy="305" rx="28" ry="18" fill="url(#cheekBlushR)" />
  <path d="M 325 290 C 340 305 355 300 358 290" stroke="#c07842" stroke-width="2" fill="none" opacity="0.3" />
  <path d="M 443 290 C 428 305 413 300 410 290" stroke="#c07842" stroke-width="2" fill="none" opacity="0.3" />

  <!-- Refined Facial Features: Eyes (Almond Hazel Eyes with Catchlight) -->
  <!-- Left Eye -->
  <path d="M 332 265 C 342 255 358 255 368 266 C 358 274 342 274 332 265 Z" fill="#ffffff" />
  <circle cx="351" cy="265" r="7" fill="url(#hazelIris)" />
  <circle cx="351" cy="265" r="3.2" fill="#0a0a0a" />
  <circle cx="349" cy="263" r="1.5" fill="#ffffff" /> <!-- Catchlight -->
  <path d="M 330 266 C 342 254 358 254 370 266" stroke="#1f140e" stroke-width="2.5" stroke-linecap="round" fill="none" /> <!-- Eyelash line -->
  <path d="M 326 248 C 340 240 360 242 372 250" stroke="#3d2114" stroke-width="2.5" stroke-linecap="round" fill="none" /> <!-- Eyebrow -->

  <!-- Right Eye -->
  <path d="M 400 266 C 410 255 426 255 436 265 C 426 274 410 274 400 266 Z" fill="#ffffff" />
  <circle cx="417" cy="265" r="7" fill="url(#hazelIris)" />
  <circle cx="417" cy="265" r="3.2" fill="#0a0a0a" />
  <circle cx="415" cy="263" r="1.5" fill="#ffffff" /> <!-- Catchlight -->
  <path d="M 398 266 C 410 254 426 254 438 266" stroke="#1f140e" stroke-width="2.5" stroke-linecap="round" fill="none" />
  <path d="M 396 250 C 408 242 428 240 442 248" stroke="#3d2114" stroke-width="2.5" stroke-linecap="round" fill="none" />

  <!-- Nose Bridge and Tip -->
  <path d="M 384 255 L 382 300 C 378 308 382 314 384 315 C 386 314 390 308 386 300 Z" fill="#c98a56" opacity="0.4" />
  <ellipse cx="384" cy="312" rx="4" ry="2.5" fill="#ab6b3a" opacity="0.5" />
  <path d="M 376 313 C 380 316 388 316 392 313" stroke="#8c4b20" stroke-width="1.2" fill="none" opacity="0.6" />

  <!-- Lips: Natural Warm Rose Smile -->
  <path d="M 364 345 C 374 340 384 342 384 343 C 384 342 394 340 404 345 C 394 352 374 352 364 345 Z" fill="#b94a48" /> <!-- Upper Lip -->
  <path d="M 366 346 C 376 358 392 358 402 346 C 392 354 376 354 366 346 Z" fill="#d46a68" /> <!-- Lower Lip -->
  <ellipse cx="384" cy="349" rx="6" ry="1.5" fill="#fca5a5" opacity="0.6" /> <!-- Lip highlight -->

  <!-- Ear and Sapphire Earring -->
  <path d="M 314 265 C 306 270 304 290 312 305 C 314 308 316 302 316 295 Z" fill="#d99b66" />
  <circle cx="308" cy="308" r="3" fill="#fbbf24" />
  <path d="M 308 311 L 306 322 C 306 325 310 325 310 322 Z" fill="#2563eb" stroke="#fbbf24" stroke-width="0.8" />

  <!-- Voluminous Front Hair & Waves (Framing Face and Shoulders) -->
  <path d="M 384 140 C 340 140 290 180 280 250 C 275 290 285 350 300 410 C 310 440 325 470 320 500 C 310 450 295 390 295 330 C 295 240 330 180 384 165 C 438 180 473 240 473 330 C 473 390 458 450 448 500 C 443 470 458 440 468 410 C 483 350 493 290 488 250 C 478 180 428 140 384 140 Z" fill="url(#hairBase)" />
  <!-- Hair Highlights and Strands -->
  <path d="M 384 145 C 350 155 315 200 305 270 C 300 320 310 380 320 440" stroke="url(#hairHighlight)" stroke-width="4" fill="none" />
  <path d="M 384 145 C 418 155 453 200 463 270 C 468 320 458 380 448 440" stroke="url(#hairHighlight)" stroke-width="4" fill="none" />
  <path d="M 360 170 C 335 210 330 250 332 270" stroke="url(#hairHighlight)" stroke-width="2.5" fill="none" />
  <path d="M 408 170 C 433 210 438 250 436 270" stroke="url(#hairHighlight)" stroke-width="2.5" fill="none" />
</svg>
  `.trim();
}

export function renderAriaDevPng(targetFilePath: string, width = 768, height = 1024): void {
  const svg = createAriaDevSvg(width, height);
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: width } });
  const pngData = resvg.render().asPng();
  fs.writeFileSync(targetFilePath, pngData);
}

if (process.argv[1] && process.argv[1].endsWith('render_aria_dev_portrait.ts')) {
  const outPath = process.argv[2] || path.resolve('./data/storage/images/char_aria_dev_real.png');
  renderAriaDevPng(outPath);
  console.log(`Rendered real Aria Dev character portrait to ${outPath} (${fs.statSync(outPath).size} bytes)`);
}

