#!/usr/bin/env python3
"""
Controlled Character Experiment Generator for Sprint 5.2.
Generates 3 photorealistic candidates for Aria Dev using the local SDXL-Lightning
pipeline on Apple Silicon MPS with CPU FP32 VAE decoding.
Computes complete metadata, high-resolution facial crops, and contact sheets.
"""
import os
import sys
import platform

# Ensure platform.mac_ver returns valid string on macOS
if not platform.mac_ver()[0]:
    platform.mac_ver = lambda: ("14.5.0", ("", "", ""), "arm64")

os.environ["HF_HUB_DISABLE_XET"] = "1"
os.environ["HF_HUB_OFFLINE"] = "1"

import time
import gc
import json
import hashlib
import torch
from PIL import Image, ImageDraw, ImageFont
import numpy as np

def main():
    torch.set_num_threads(8)
    cache_dir = os.path.expanduser("/Users/abhisheksuman/.local/share/auravo/models/phase2b/cache")
    evidence_dir = os.path.abspath("docs/sprint5_2_evidence")
    os.makedirs(evidence_dir, exist_ok=True)

    from huggingface_hub import hf_hub_download
    from safetensors.torch import load_file
    from diffusers import StableDiffusionXLPipeline, UNet2DConditionModel, EulerDiscreteScheduler

    base_repo = "stabilityai/stable-diffusion-xl-base-1.0"
    lightning_repo = "ByteDance/SDXL-Lightning"
    unet_ckpt = "sdxl_lightning_4step_unet.safetensors"

    print("[Sprint 5.2] Loading UNet checkpoint from local cache...")
    t_load_start = time.time()
    unet_file = hf_hub_download(lightning_repo, unet_ckpt, cache_dir=cache_dir, local_files_only=True)
    unet = UNet2DConditionModel.from_config(base_repo, subfolder="unet", cache_dir=cache_dir, local_files_only=True).to(dtype=torch.float16)
    state_dict = load_file(unet_file)
    unet.load_state_dict(state_dict)
    del state_dict
    gc.collect()

    print("[Sprint 5.2] Assembling pipeline...")
    pipe = StableDiffusionXLPipeline.from_pretrained(
        base_repo,
        unet=unet,
        torch_dtype=torch.float16,
        variant="fp16",
        cache_dir=cache_dir,
        local_files_only=True
    )
    pipe.scheduler = EulerDiscreteScheduler.from_config(
        pipe.scheduler.config,
        timestep_spacing="trailing"
    )

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    print(f"[Sprint 5.2] Moving pipeline to device: {device}...")
    pipe.to(device)
    if device == "mps":
        torch.mps.synchronize()

    # Isolate VAE to CPU in FP32
    pipe.vae.to(device="cpu", dtype=torch.float32)
    scaling_factor = float(pipe.vae.config.scaling_factor)
    print(f"[Sprint 5.2] Pipeline initialized in {time.time() - t_load_start:.2f}s.")

    prompt = (
        "Photorealistic studio portrait of Aria Dev, a 26-year-old female creative technologist and AI engineer, "
        "South Asian heritage, warm expressive hazel-brown eyes, natural subtle smile, authentic skin texture with natural fine pores and soft tonal variation, "
        "dark brown wavy hair with individual strands and natural hairline, wearing an elegant tailored emerald green silk blouse with delicate gold embroidery, "
        "sharp focus, 85mm f/1.8 portrait lens, cinematic soft studio lighting, ultra-realistic human photograph"
    )

    negative_prompt = (
        "illustration, drawing, painting, 3d render, cartoon, anime, vector art, graphic novel, doll, wax, "
        "plastic skin, overly smooth, airbrushed, deformed eyes, crossed eyes, bad pupils, deformed nose, deformed mouth, "
        "extra limbs, bad anatomy, blurry, oversaturated, low resolution"
    )

    seeds = [101, 202, 303]
    candidate_records = []

    for idx, seed in enumerate(seeds, 1):
        print(f"\n[Sprint 5.2] Generating Candidate {idx} (Seed {seed})...")
        t0 = time.time()
        generator = torch.Generator(device="cpu").manual_seed(seed)

        t_denoise_start = time.time()
        denoise_out = pipe(
            prompt=prompt,
            negative_prompt=negative_prompt,
            num_inference_steps=4,
            guidance_scale=0,
            generator=generator,
            width=1024,
            height=1024,
            output_type="latent"
        )
        if device == "mps":
            torch.mps.synchronize()
        denoise_dur = time.time() - t_denoise_start

        # VAE decoding
        t_vae_start = time.time()
        raw_latents = denoise_out.images
        scaled_latents = raw_latents / scaling_factor
        latents_cpu = scaled_latents.to(device="cpu", dtype=torch.float32)

        with torch.no_grad():
            decoded_tensor = pipe.vae.decode(latents_cpu, return_dict=False)[0]
        vae_dur = time.time() - t_vae_start

        # Post-process
        image_normalized = (decoded_tensor / 2.0 + 0.5).clamp(0.0, 1.0)
        image_np = image_normalized.cpu().permute(0, 2, 3, 1).float().numpy()
        image_uint8 = (image_np * 255.0).round().astype("uint8")[0]
        pil_img = Image.fromarray(image_uint8)

        cand_filename = f"candidate_{idx}.png"
        cand_path = os.path.join(evidence_dir, cand_filename)
        pil_img.save(cand_path, format="PNG")

        with open(cand_path, "rb") as f:
            sha256 = hashlib.sha256(f.read()).hexdigest()
        file_size = os.path.getsize(cand_path)

        img_arr = np.array(pil_img)
        min_px = int(img_arr.min())
        max_px = int(img_arr.max())
        mean_px = float(img_arr.mean())
        std_px = float(img_arr.std())
        unique_colors = int(len(np.unique(img_arr.reshape(-1, 3), axis=0)))

        rec = {
            "candidate_id": idx,
            "filename": cand_filename,
            "path": cand_path,
            "seed": seed,
            "prompt": prompt,
            "negative_prompt": negative_prompt,
            "model": "stabilityai/stable-diffusion-xl-base-1.0 + ByteDance/SDXL-Lightning",
            "model_license": "CreativeML Open RAIL++-M / Apache 2.0 (FREE_OPEN_SOURCE_LOCAL)",
            "dimensions": [1024, 1024],
            "file_size_bytes": file_size,
            "sha256": sha256,
            "steps": 4,
            "guidance_scale": 0,
            "timings": {
                "denoise_seconds": round(denoise_dur, 2),
                "vae_seconds": round(vae_dur, 2),
                "total_seconds": round(time.time() - t0, 2)
            },
            "pixel_stats": {
                "min": min_px,
                "max": max_px,
                "mean": round(mean_px, 2),
                "std": round(std_px, 2),
                "unique_colors": unique_colors
            }
        }
        candidate_records.append(rec)
        print(f"[Sprint 5.2] Candidate {idx} completed in {rec['timings']['total_seconds']}s (Denoise: {denoise_dur:.2f}s, VAE: {vae_dur:.2f}s). SHA: {sha256[:12]}")

        del denoise_out
        del raw_latents
        del scaled_latents
        del latents_cpu
        del decoded_tensor
        del image_normalized
        gc.collect()

    # Save generation metadata JSON
    meta_path = os.path.join(evidence_dir, "generation_metadata.json")
    with open(meta_path, "w") as f:
        json.dump({"sprint": "5.2", "candidates": candidate_records}, f, indent=2)
    print(f"\n[Sprint 5.2] Saved generation metadata to {meta_path}")

    # Build Comparison Contact Sheet
    # 4 columns: [Baseline Sprint 5 Vector Aria Dev] | [Candidate 1] | [Candidate 2] | [Candidate 3]
    print("\n[Sprint 5.2] Creating character comparison contact sheet...")
    baseline_path = os.path.abspath("data/storage/images/char_aria_dev_1794907355086.png")
    if os.path.exists(baseline_path):
        baseline_img = Image.open(baseline_path).convert("RGB")
        # Resize baseline to 1024x1024 if needed
        baseline_img = baseline_img.resize((1024, 1024), Image.Resampling.LANCZOS)
    else:
        baseline_img = Image.new("RGB", (1024, 1024), (30, 30, 30))

    cand_imgs = [Image.open(os.path.join(evidence_dir, f"candidate_{i}.png")).convert("RGB") for i in range(1, 4)]
    all_images = [baseline_img] + cand_imgs
    labels = [
        "Baseline (Sprint 5 Illustrated)",
        f"Candidate 1 (Seed {seeds[0]})",
        f"Candidate 2 (Seed {seeds[1]})",
        f"Candidate 3 (Seed {seeds[2]})"
    ]

    thumb_w, thumb_h = 512, 512
    margin = 20
    header_h = 50
    total_w = 4 * thumb_w + 5 * margin
    total_h = thumb_h + 2 * margin + header_h

    contact_sheet = Image.new("RGB", (total_w, total_h), (24, 24, 27))
    draw = ImageDraw.Draw(contact_sheet)

    for i, (img, label) in enumerate(zip(all_images, labels)):
        thumb = img.resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
        x = margin + i * (thumb_w + margin)
        y = margin + header_h
        contact_sheet.paste(thumb, (x, y))

        # Border
        draw.rectangle([x - 1, y - 1, x + thumb_w + 1, y + thumb_h + 1], outline=(80, 80, 90), width=2)
        # Label text box
        draw.rectangle([x, margin, x + thumb_w, margin + header_h - 10], fill=(39, 39, 42))
        draw.text((x + 15, margin + 12), label, fill=(240, 240, 245))

    contact_path = os.path.join(evidence_dir, "character_comparison_contact_sheet.png")
    contact_sheet.save(contact_path, format="PNG")
    print(f"[Sprint 5.2] Saved contact sheet to {contact_path}")

    # Build High-Resolution Facial Detail Comparison
    # Crop facial region (e.g. box [250, 150, 774, 674]) from each candidate to inspect eyes, nose, skin, hair
    print("[Sprint 5.2] Creating facial detail comparison sheet...")
    crop_box = (250, 150, 774, 674) # 524x524 crop centered on face
    facial_crops = [img.crop(crop_box) for img in cand_imgs]

    crop_w, crop_h = 500, 500
    detail_sheet = Image.new("RGB", (3 * crop_w + 4 * margin, crop_h + 2 * margin + header_h), (24, 24, 27))
    draw_detail = ImageDraw.Draw(detail_sheet)

    for i, (crop, label) in enumerate(zip(facial_crops, [f"Candidate {i} Facial Detail (Seed {s})" for i, s in enumerate(seeds, 1)])):
        c_thumb = crop.resize((crop_w, crop_h), Image.Resampling.LANCZOS)
        x = margin + i * (crop_w + margin)
        y = margin + header_h
        detail_sheet.paste(c_thumb, (x, y))
        draw_detail.rectangle([x - 1, y - 1, x + crop_w + 1, y + crop_h + 1], outline=(100, 100, 120), width=2)
        draw_detail.rectangle([x, margin, x + crop_w, margin + header_h - 10], fill=(39, 39, 42))
        draw_detail.text((x + 15, margin + 12), label, fill=(240, 240, 245))

    detail_path = os.path.join(evidence_dir, "facial_detail_comparison.png")
    detail_sheet.save(detail_path, format="PNG")
    print(f"[Sprint 5.2] Saved facial detail comparison to {detail_path}")

    print("\n[Sprint 5.2] All candidates and visual comparisons generated successfully.")

if __name__ == "__main__":
    main()
