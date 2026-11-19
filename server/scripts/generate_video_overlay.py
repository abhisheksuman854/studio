#!/usr/bin/env python3
"""
Auravo Studio — Video Studio: Video Overlay Generator
Generates high-definition transparent RGBA overlays with anti-aliased typography,
character branding badges, titles, and subtitles without requiring external font libraries
or libfreetype in FFmpeg.
"""

import argparse
import os
import sys
from PIL import Image, ImageDraw, ImageFont

def get_font(size: int):
    candidates = [
        '/System/Library/Fonts/Helvetica.ttc',
        '/System/Library/Fonts/SFPro.ttf',
        '/System/Library/Fonts/Supplemental/Arial.ttf',
        '/System/Library/Fonts/Supplemental/Verdana.ttf',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    ]
    for font_path in candidates:
        if os.path.exists(font_path):
            try:
                return ImageFont.truetype(font_path, size)
            except Exception:
                continue
    return ImageFont.load_default()

def wrap_text(text: str, font, max_width: int, draw: ImageDraw.ImageDraw):
    words = text.split()
    lines = []
    current_line = []
    for word in words:
        test_line = ' '.join(current_line + [word])
        bbox = draw.textbbox((0, 0), test_line, font=font)
        line_w = bbox[2] - bbox[0]
        if line_w <= max_width:
            current_line.append(word)
        else:
            if current_line:
                lines.append(' '.join(current_line))
                current_line = [word]
            else:
                lines.append(word)
                current_line = []
    if current_line:
        lines.append(' '.join(current_line))
    return lines

def main():
    parser = argparse.ArgumentParser(description="Auravo Video Studio Overlay Generator")
    parser.add_argument("--width", type=int, required=True, help="Target canvas width")
    parser.add_argument("--height", type=int, required=True, help="Target canvas height")
    parser.add_argument("--title", type=str, default="", help="Opening title text")
    parser.add_argument("--subtitle", type=str, default="", help="Subtitle / caption text")
    parser.add_argument("--character-name", type=str, default="", help="Character name watermark")
    parser.add_argument("--output", type=str, required=True, help="Output PNG path")

    args = parser.parse_args()

    width = args.width
    height = args.height
    title = (args.title or "").strip()
    subtitle = (args.subtitle or "").strip()
    char_name = (args.character_name or "").strip()

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    if not title and not subtitle and not char_name:
        img.save(args.output, "PNG")
        print(f"Empty overlay created at {args.output}")
        return

    # Responsive typography sizing
    title_size = max(24, int(width * 0.038))
    subtitle_size = max(20, int(width * 0.028))
    badge_size = max(18, int(width * 0.024))

    font_title = get_font(title_size)
    font_sub = get_font(subtitle_size)
    font_badge = get_font(badge_size)

    # 1. Header Title / Badge
    if title:
        title_bbox = draw.textbbox((0, 0), title, font=font_title)
        t_w = title_bbox[2] - title_bbox[0]
        t_h = title_bbox[3] - title_bbox[1]
        
        box_pad_x = int(width * 0.04)
        box_pad_y = int(height * 0.015)
        box_w = min(int(width * 0.90), t_w + box_pad_x * 2)
        box_h = t_h + box_pad_y * 2
        
        box_x0 = (width - box_w) // 2
        box_y0 = int(height * 0.05)
        box_x1 = box_x0 + box_w
        box_y1 = box_y0 + box_h

        # Dark translucent card with warm gold accent border
        draw.rounded_rectangle(
            [(box_x0, box_y0), (box_x1, box_y1)],
            radius=16,
            fill=(15, 23, 42, 225),
            outline=(245, 158, 11, 240),
            width=3
        )
        draw.text(
            ((box_x0 + box_x1) // 2, (box_y0 + box_y1) // 2),
            title,
            fill=(255, 255, 255, 255),
            font=font_title,
            anchor="mm"
        )

    # 2. Character Branding Badge (if specified and distinct from title)
    if char_name and (not title or char_name.lower() not in title.lower()):
        badge_text = f"✦ {char_name}"
        b_bbox = draw.textbbox((0, 0), badge_text, font=font_badge)
        b_w = b_bbox[2] - b_bbox[0]
        b_h = b_bbox[3] - b_bbox[1]
        
        pad_x = 18
        pad_y = 10
        bx0 = int(width * 0.05)
        by0 = int(height * 0.02)
        bx1 = bx0 + b_w + pad_x * 2
        by1 = by0 + b_h + pad_y * 2

        draw.rounded_rectangle(
            [(bx0, by0), (bx1, by1)],
            radius=12,
            fill=(30, 27, 75, 210),
            outline=(129, 140, 248, 200),
            width=2
        )
        draw.text(
            ((bx0 + bx1) // 2, (by0 + by1) // 2),
            badge_text,
            fill=(224, 231, 255, 255),
            font=font_badge,
            anchor="mm"
        )

    # 3. Subtitles / Captions at Bottom
    if subtitle:
        max_sub_w = int(width * 0.85)
        lines = wrap_text(subtitle, font_sub, max_sub_w, draw)
        if lines:
            line_height = int(subtitle_size * 1.35)
            total_text_h = len(lines) * line_height
            sub_box_pad_x = int(width * 0.04)
            sub_box_pad_y = int(height * 0.015)
            
            sub_box_w = min(int(width * 0.92), max([draw.textbbox((0, 0), l, font=font_sub)[2] - draw.textbbox((0, 0), l, font=font_sub)[0] for l in lines]) + sub_box_pad_x * 2)
            sub_box_h = total_text_h + sub_box_pad_y * 2
            
            sub_x0 = (width - sub_box_w) // 2
            sub_y0 = int(height * 0.88) - (sub_box_h // 2)
            sub_x1 = sub_x0 + sub_box_w
            sub_y1 = sub_y0 + sub_box_h

            draw.rounded_rectangle(
                [(sub_x0, sub_y0), (sub_x1, sub_y1)],
                radius=14,
                fill=(15, 23, 42, 220),
                outline=(99, 102, 241, 180),
                width=2
            )

            start_y = sub_y0 + sub_box_pad_y + (line_height // 2)
            for i, line in enumerate(lines):
                cur_y = start_y + (i * line_height)
                draw.text(
                    (width // 2, cur_y),
                    line,
                    fill=(248, 250, 252, 255),
                    font=font_sub,
                    anchor="mm"
                )

    img.save(args.output, "PNG")
    print(f"Overlay successfully generated: {args.output} ({width}x{height})")

if __name__ == "__main__":
    main()

