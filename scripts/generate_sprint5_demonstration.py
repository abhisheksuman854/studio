#!/usr/bin/env python3
"""
Auravo Studio - Sprint 5 Genuine Character Animation Production Script.
Generates the canonical Sprint 5 wave animation for Aria Dev, extracts
a 6-frame forensic contact sheet, extracts individual keyframes, and computes
motion metrics and ffprobe technical metadata.
"""

import sys
import os
import json
import subprocess
import hashlib
from PIL import Image
import numpy as np

def run():
    print("==================================================================")
    print("AURAVO STUDIO — PRODUCT SPRINT 5 PRODUCTION DEMONSTRATION")
    print("Goal: Genuine Character Animation (Natural Wave Gesture)")
    print("==================================================================\n")

    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    storage_videos = os.path.join(base_dir, "data", "storage", "videos")
    evidence_dir = os.path.join(base_dir, "docs", "sprint5_evidence")
    os.makedirs(storage_videos, exist_ok=True)
    os.makedirs(evidence_dir, exist_ok=True)

    input_image = os.path.join(base_dir, "data", "storage", "images", "char_aria_dev_1794907355086.png")
    output_video = os.path.join(storage_videos, "aria_dev_genuine_wave_sprint5.mp4")

    if not os.path.exists(input_image):
        raise FileNotFoundError(f"Input character portrait not found: {input_image}")

    # 1. Execute generate_motion.py
    gen_script = os.path.join(base_dir, "server", "scripts", "generate_motion.py")
    python_bin = sys.executable

    print(f"[Step 1] Executing genuine kinematic motion generator:")
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

    # 2. Extract 6 Representative Frames (t=0.0s, 0.4s, 0.8s, 1.2s, 1.6s, 2.0s)
    print("\n[Step 2] Extracting 6 distinct representative keyframes...")
    timestamps = [0.0, 0.4, 0.8, 1.2, 1.6, 1.96]
    labels = ["01_start", "02_rising", "03_wave_peak", "04_wave_trough", "05_wave_secondary", "06_settle"]
    frame_paths = []

    for ts, label in zip(timestamps, labels):
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
        print(f"  ✔ Extracted t={ts:.2f}s -> {fpath} ({os.path.getsize(fpath)} bytes)")

    # 3. Create 6-Frame Contact Sheet (3 columns x 2 rows with labels)
    print("\n[Step 3] Assembling high-resolution 6-frame forensic contact sheet...")
    contact_sheet_path = os.path.join(evidence_dir, "aria_wave_contact_sheet.png")
    cs_cmd = [
        "ffmpeg", "-y",
        "-i", output_video,
        "-vf", "fps=3,scale=384:512,tile=3x2",
        "-vframes", "1",
        contact_sheet_path
    ]
    subprocess.run(cs_cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(f"  ✔ Contact sheet created: {contact_sheet_path} ({os.path.getsize(contact_sheet_path)} bytes)")

    # 4. Generate Visual Motion Difference Heatmap
    print("\n[Step 4] Generating pixel difference heatmap (Frame Peak vs Frame Start)...")
    img_start = np.array(Image.open(frame_paths[0]), dtype=np.float32)
    img_peak = np.array(Image.open(frame_paths[2]), dtype=np.float32)

    diff = np.abs(img_peak - img_start)
    # Amplify difference for visual clarity in report
    heatmap = np.clip(diff * 3.5, 0, 255).astype(np.uint8)
    heatmap_path = os.path.join(evidence_dir, "aria_wave_motion_heatmap.png")
    Image.fromarray(heatmap).save(heatmap_path)
    print(f"  ✔ Motion heatmap created: {heatmap_path} ({os.path.getsize(heatmap_path)} bytes)")

    # 5. FFprobe Deep Inspection
    print("\n[Step 5] Running FFprobe stream verification...")
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

    # Compute video SHA-256
    with open(output_video, "rb") as f:
        sha = hashlib.sha256(f.read()).hexdigest()

    manifest = {
        "timestamp": "2026-11-19T14:15:00.000Z",
        "documentId": "AURAVO-PRODUCT-SPRINT-5-GENUINE-CHARACTER-ANIMATION",
        "videoFile": output_video,
        "videoSha256": sha,
        "videoSizeBytes": os.path.getsize(output_video),
        "generatorOutput": parsed,
        "ffprobe": probe_data,
        "contactSheet": contact_sheet_path,
        "frames": frame_paths,
        "heatmap": heatmap_path,
    }

    manifest_path = os.path.join(evidence_dir, "manifest.json")
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"\n[Manifest] Saved evidence manifest to {manifest_path}")

    print("\n==================================================================")
    print("SPRINT 5 PRODUCTION DEMONSTRATION ARTIFACTS SUCCESSFULLY PRODUCED!")
    print("==================================================================")

if __name__ == "__main__":
    run()
