#!/usr/bin/env python3
"""
SDXL-Lightning Local Character Generator for Auravo Studio.
Executes 4-step distilled UNet denoising on Apple MPS and FP32 VAE decoding on CPU
to avoid Apple Silicon MPS half-precision NaN artifacts.
Uses strictly local cached weights ($0.00 cost, zero network calls).
"""
import os
import sys

# Disable HF transfer/xet to ensure zero remote calls
os.environ["HF_HUB_DISABLE_XET"] = "1"
os.environ["HF_HUB_OFFLINE"] = "1"

import argparse
import time
import gc
import json
import hashlib
import torch
from PIL import Image
import numpy as np

def main():
    parser = argparse.ArgumentParser(description="Auravo Studio Local SDXL Character Generator")
    parser.add_argument("--prompt", required=True, help="Text prompt for character generation")
    parser.add_argument("--negative-prompt", default="ugly, deformed, disfigured, poor details, bad anatomy, blurry", help="Negative prompt")
    parser.add_argument("--output-path", required=True, help="Destination PNG file path")
    parser.add_argument("--seed", type=int, default=None, help="Inference seed")
    parser.add_argument("--width", type=int, default=1024, help="Output width")
    parser.add_argument("--height", type=int, default=1024, help="Output height")
    parser.add_argument("--steps", type=int, default=4, help="Diffusion inference steps")
    parser.add_argument("--cache-dir", default="/Users/abhisheksuman/.local/share/auravo/models/phase2b/cache", help="Local HF cache directory")
    args = parser.parse_args()

    t0 = time.time()
    cache_dir = os.path.expanduser(args.cache_dir)
    seed = args.seed if args.seed is not None else int(time.time()) % 1000000

    from huggingface_hub import hf_hub_download
    from safetensors.torch import load_file
    from diffusers import StableDiffusionXLPipeline, UNet2DConditionModel, EulerDiscreteScheduler

    base_repo = "stabilityai/stable-diffusion-xl-base-1.0"
    lightning_repo = "ByteDance/SDXL-Lightning"
    unet_ckpt = "sdxl_lightning_4step_unet.safetensors"

    # Step 1: Load UNet from local cache
    unet_file = hf_hub_download(lightning_repo, unet_ckpt, cache_dir=cache_dir, local_files_only=True)
    unet = UNet2DConditionModel.from_config(base_repo, subfolder="unet", cache_dir=cache_dir, local_files_only=True).to(dtype=torch.float16)
    state_dict = load_file(unet_file)
    unet.load_state_dict(state_dict)
    del state_dict
    gc.collect()

    # Step 2: Assemble Pipeline
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

    # Use Apple MPS for Text Encoder & UNet Denoising
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    pipe.to(device)
    if device == "mps":
        torch.mps.synchronize()

    # CRITICAL: Isolate and pin VAE explicitly to CPU in FP32 to prevent Apple MPS NaN black-image defect
    pipe.vae.to(device="cpu", dtype=torch.float32)

    # Step 3: Denoising on MPS
    t_denoise_start = time.time()
    generator = torch.Generator(device="cpu").manual_seed(seed)
    denoise_out = pipe(
        prompt=args.prompt,
        negative_prompt=args.negative_prompt,
        num_inference_steps=args.steps,
        guidance_scale=0,
        generator=generator,
        width=args.width,
        height=args.height,
        output_type="latent"
    )
    if device == "mps":
        torch.mps.synchronize()
    denoise_dur = time.time() - t_denoise_start

    raw_latents = denoise_out.images

    # Step 4: VAE Decoding on CPU in FP32
    t_vae_start = time.time()
    scaling_factor = float(pipe.vae.config.scaling_factor)
    scaled_latents = raw_latents / scaling_factor
    latents_cpu = scaled_latents.to(device="cpu", dtype=torch.float32)

    with torch.no_grad():
        decoded_tensor = pipe.vae.decode(latents_cpu, return_dict=False)[0]
    vae_dur = time.time() - t_vae_start

    # Step 5: Post-processing to PIL RGB
    image_normalized = (decoded_tensor / 2.0 + 0.5).clamp(0.0, 1.0)
    image_np = image_normalized.cpu().permute(0, 2, 3, 1).float().numpy()
    image_uint8 = (image_np * 255.0).round().astype("uint8")[0]
    pil_img = Image.fromarray(image_uint8)

    # Ensure output directory exists
    out_dir = os.path.dirname(os.path.abspath(args.output_path))
    os.makedirs(out_dir, exist_ok=True)
    pil_img.save(args.output_path, format="PNG")

    # Step 6: Numerical & Image Validation
    file_size = os.path.getsize(args.output_path)
    with open(args.output_path, "rb") as f:
        sha256_hash = hashlib.sha256(f.read()).hexdigest()

    img_arr = np.array(pil_img)
    min_px = int(img_arr.min())
    max_px = int(img_arr.max())
    mean_px = float(img_arr.mean())
    std_px = float(img_arr.std())
    unique_colors = int(len(np.unique(img_arr.reshape(-1, 3), axis=0)))
    is_black = bool(mean_px < 1.0 and std_px < 1.0)
    is_white = bool(mean_px > 254.0 and std_px < 1.0)
    valid_render = bool(not is_black and not is_white and std_px > 15.0 and unique_colors > 1000)

    total_dur = time.time() - t0

    result = {
        "ok": True,
        "output_path": args.output_path,
        "file_size_bytes": file_size,
        "sha256": sha256_hash,
        "dimensions": [pil_img.width, pil_img.height],
        "pixel_stats": {
            "min": min_px,
            "max": max_px,
            "mean": round(mean_px, 2),
            "std": round(std_px, 2),
            "unique_colors": unique_colors,
            "is_solid_black": is_black,
            "is_solid_white": is_white,
            "valid_render": valid_render
        },
        "timings": {
            "denoise_seconds": round(denoise_dur, 2),
            "vae_seconds": round(vae_dur, 2),
            "total_seconds": round(total_dur, 2)
        },
        "parameters": {
            "prompt": args.prompt,
            "negative_prompt": args.negative_prompt,
            "seed": seed,
            "steps": args.steps,
            "dimensions": f"{args.width}x{args.height}"
        }
    }

    # Teardown
    del pipe
    del unet
    del denoise_out
    del raw_latents
    del scaled_latents
    del latents_cpu
    del decoded_tensor
    del image_normalized
    gc.collect()
    if device == "mps":
        torch.mps.empty_cache()

    print(json.dumps(result))

if __name__ == "__main__":
    main()

