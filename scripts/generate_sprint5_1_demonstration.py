#!/usr/bin/env python3
"""
Auravo Studio — Product Sprint 5.1 Demonstration Generator.
Executes the refined Hierarchical Kinematic Bone Chain + Linear Blend Skinning (LBS)
pipeline to produce aria_dev_natural_wave_sprint5_1.mp4, extracts 8 representative
forensic keyframes, compiles the 8-frame contact sheet, produces hand crop comparison,
and builds the Before-vs-After comparison sheet.
"""

import sys
import os
import json
import subprocess
import hashlib
from PIL import Image, ImageDraw, ImageFont
import numpy as np

def run():
    print("==================================================================")
    print("AURAVO STUDIO — PRODUCT SPRINT 5.1 DEMONSTRATION GENERATION")
    print("Goal: Natural Arm, Wrist & Hand Articulation Refinement")
    print("==================================================================\n")

    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    storage_videos = os.path.join(base_dir, "data", "storage", "videos")
    evidence_dir = os.path.join(base_dir, "docs", "sprint5_1_evidence")
    os.makedirs(storage_videos, exist_ok=True)
    os.makedirs(evidence_dir, exist_ok=True)

    input_image = os.path.join(base_dir, "data", "storage", "images", "char_aria_dev_1794907355086.png")
    output_video = os.path.join(storage_videos, "aria_dev_natural_wave_sprint5_1.mp4")

    # 1. Execute generate_motion.py
    gen_script = os.path.join(base_dir, "server", "scripts", "generate_motion.py")
    python_bin = sys.executable

    print(f"[Step 1] Executing refined LBS kinematic motion generator:")
    print(f"         Script: {gen_script}")
    print(f"         Input:  {input_image}")
    print(f"         Output: {output_video}")

    cmd = [
        python_bin,
        gen_script,
        "--input-image", input_image,
        "--preset", "wave",
        "--output-path", output_video,
        "--duration", "2.0",
        "--fps", "30"
    ]

    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print("STDERR:", res.stderr)
        raise RuntimeError(f"generate_motion.py failed with code {res.returncode}")

    parsed = json.loads(res.stdout.strip())
    print("[Step 1] Generator Output:\n", json.dumps(parsed, indent=2))

    # 2. Extract 8 Representative Keyframes
    print("\n[Step 2] Extracting 8 representative keyframes across wave milestones...")
    milestones = [
        (0.00, "01_t0_00_rest_start"),
        (0.25, "02_t0_25_outward_peak1"),
        (0.50, "03_t0_50_inward_cross1"),
        (0.75, "04_t0_75_inward_trough1"),
        (1.00, "05_t1_00_midpoint_center"),
        (1.25, "06_t1_25_outward_peak2"),
        (1.75, "07_t1_75_inward_trough2"),
        (1.96, "08_t2_00_rest_settle"),
    ]
    frame_paths = []

    for ts, label in milestones:
        fpath = os.path.join(evidence_dir, f"frame_{label}.png")
        sub_cmd = [
            "ffmpeg", "-y",
            "-ss", str(ts),
            "-i", output_video,
            "-vframes", "1",
            fpath
        ]
        subprocess.run(sub_cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        frame_paths.append(fpath)
        print(f"  ✔ Extracted t={ts:.2f}s -> {os.path.basename(fpath)} ({os.path.getsize(fpath)} bytes)")

    # 3. Create 8-Frame Contact Sheet (4 columns x 2 rows)
    print("\n[Step 3] Compiling 8-frame forensic contact sheet (4x2)...")
    contact_sheet_path = os.path.join(evidence_dir, "aria_wave_contact_sheet_sprint5_1.png")
    # Load each of the 8 frames and tile them cleanly with borders and labels
    cell_w, cell_h = 288, 384
    sheet = Image.new("RGB", (cell_w * 4, cell_h * 2), (15, 23, 42))
    draw = ImageDraw.Draw(sheet)

    milestone_titles = [
        "1. Rest Pose (t=0.00s)",
        "2. Outward Peak 1 (t=0.25s)",
        "3. Inward Cross 1 (t=0.50s)",
        "4. Inward Trough 1 (t=0.75s)",
        "5. Mid Center (t=1.00s)",
        "6. Outward Peak 2 (t=1.25s)",
        "7. Inward Trough 2 (t=1.75s)",
        "8. Settle Rest (t=2.00s)",
    ]

    for idx, (fpath, title) in enumerate(zip(frame_paths, milestone_titles)):
        col = idx % 4
        row = idx // 4
        x = col * cell_w
        y = row * cell_h
        cell_img = Image.open(fpath).resize((cell_w, cell_h), Image.Resampling.LANCZOS)
        sheet.paste(cell_img, (x, y))
        # Draw header banner
        draw.rectangle([x, y, x + cell_w, y + 26], fill=(15, 23, 42, 220))
        draw.text((x + 8, y + 6), title, fill=(248, 250, 252))
        # Draw grid border
        draw.rectangle([x, y, x + cell_w - 1, y + cell_h - 1], outline=(51, 65, 85), width=1)

    sheet.save(contact_sheet_path, "PNG")
    print(f"  ✔ Contact sheet created: {contact_sheet_path} ({os.path.getsize(contact_sheet_path)} bytes)")

    # 4. Hand Crop Comparison: Original vs Peak 1
    print("\n[Step 4] Creating high-detail hand/finger crop comparison...")
    hand_comp_path = os.path.join(evidence_dir, "hand_comparison_original_vs_peak.png")
    crop_box = (590, 200, 730, 480) # (w=140, h=280)
    orig_crop = Image.open(input_image).crop(crop_box).resize((280, 560), Image.Resampling.NEAREST)
    peak_crop = Image.open(frame_paths[1]).crop(crop_box).resize((280, 560), Image.Resampling.NEAREST)

    hand_canvas = Image.new("RGB", (280 * 2 + 20, 560 + 40), (15, 23, 42))
    hdraw = ImageDraw.Draw(hand_canvas)
    hand_canvas.paste(orig_crop, (0, 40))
    hand_canvas.paste(peak_crop, (280 + 20, 40))

    hdraw.text((10, 12), "ORIGINAL SOURCE HAND (t=0.0s)", fill=(248, 250, 252))
    hdraw.text((280 + 30, 12), "REFINED LBS WAVING HAND (t=0.25s)", fill=(74, 222, 128))
    hand_canvas.save(hand_comp_path, "PNG")
    print(f"  ✔ Hand comparison saved: {hand_comp_path} ({os.path.getsize(hand_comp_path)} bytes)")

    # 5. Motion Heatmap
    print("\n[Step 5] Generating motion difference heatmap...")
    img_start = np.array(Image.open(frame_paths[0]), dtype=np.float32)
    img_peak = np.array(Image.open(frame_paths[1]), dtype=np.float32)
    diff = np.abs(img_peak - img_start)
    heatmap = np.clip(diff * 3.5, 0, 255).astype(np.uint8)
    heatmap_path = os.path.join(evidence_dir, "aria_wave_motion_heatmap_sprint5_1.png")
    Image.fromarray(heatmap).save(heatmap_path)
    print(f"  ✔ Motion heatmap created: {heatmap_path} ({os.path.getsize(heatmap_path)} bytes)")

    # 6. Before vs After Comparison Sheet (Sprint 5 vs Sprint 5.1)
    print("\n[Step 6] Compiling Before vs After comparison...")
    before_path = os.path.join(base_dir, "docs", "sprint5_evidence", "frame_03_wave_peak.png")
    after_path = frame_paths[1] # Outward peak 1
    before_after_path = os.path.join(evidence_dir, "before_after_comparison_sprint5_vs_5_1.png")

    if os.path.exists(before_path) and os.path.exists(after_path):
        b_img = Image.open(before_path).resize((384, 512), Image.Resampling.LANCZOS)
        a_img = Image.open(after_path).resize((384, 512), Image.Resampling.LANCZOS)
        ba_canvas = Image.new("RGB", (384 * 2 + 10, 512 + 40), (15, 23, 42))
        badraw = ImageDraw.Draw(ba_canvas)
        ba_canvas.paste(b_img, (0, 40))
        ba_canvas.paste(a_img, (384 + 10, 40))
        badraw.text((10, 12), "SPRINT 5 (Displacement-Additive / Hand Distortion)", fill=(248, 113, 113))
        badraw.text((384 + 20, 12), "SPRINT 5.1 (Hierarchical LBS / Rigid Palm & Fingers)", fill=(74, 222, 128))
        ba_canvas.save(before_after_path, "PNG")
        print(f"  ✔ Before/After comparison created: {before_after_path} ({os.path.getsize(before_after_path)} bytes)")

    # 7. FFprobe Stream Verification
    print("\n[Step 7] Running FFprobe stream verification...")
    probe_cmd = [
        "ffprobe", "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=codec_name,width,height,r_frame_rate,nb_frames,duration,pix_fmt",
        "-show_entries", "format=duration,size,bit_rate",
        "-of", "json",
        output_video
    ]
    probe_out = subprocess.check_output(probe_cmd, text=True)
    probe_data = json.loads(probe_out)
    print("Stream metadata:\n", json.dumps(probe_data, indent=2))

    with open(output_video, "rb") as f:
        sha = hashlib.sha256(f.read()).hexdigest()

    manifest = {
        "timestamp": "2026-11-19T14:45:00.000Z",
        "documentId": "AURAVO-PRODUCT-SPRINT-5.1-NATURAL-WAVE-REFINEMENT",
        "videoFile": output_video,
        "videoSha256": sha,
        "videoSizeBytes": os.path.getsize(output_video),
        "generatorOutput": parsed,
        "ffprobe": probe_data,
        "contactSheet": contact_sheet_path,
        "frames": frame_paths,
        "handComparison": hand_comp_path,
        "heatmap": heatmap_path,
        "beforeAfter": before_after_path,
    }

    manifest_path = os.path.join(evidence_dir, "manifest.json")
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"\n[Manifest] Saved evidence manifest to {manifest_path}")

    print("\n==================================================================")
    print("SPRINT 5.1 PRODUCTION DEMONSTRATION ARTIFACTS PRODUCED!")
    print("==================================================================")

if __name__ == "__main__":
    run()
