#!/usr/bin/env python3
"""Generate placeholder pass template JPGs for CSN Signature Events.
Each template is 1080x1350 with a clearly-marked 320x320 QR zone at (380, 920).
The server's sharp pipeline composites the actual QR onto this zone at runtime.
"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "templates")
os.makedirs(OUT_DIR, exist_ok=True)

TIERS = [
    ("female_pass.jpg",    "Female Pass",    "#FF422E", 999),
    ("male_pass.jpg",      "Male Pass",      "#9B7BFF", 2499),
    ("couple_pass.jpg",    "Couple Pass",    "#F8A91F", 2999),
    ("standing_table.jpg", "Standing Table", "#67D4FF", 20000),
    ("seating_table.jpg",  "Seating Table",  "#7CE8C8", 30000),
]

# Font paths (Linux env)
DISPLAY_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
MONO_FONT    = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"

def find_font(paths, size):
    for p in paths:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()

def make_template(filename, tier_name, color, price):
    W, H = 1080, 1350
    img = Image.new("RGB", (W, H), color)
    d = ImageDraw.Draw(img)

    # Outer ink border
    d.rectangle([40, 40, W-40, H-40], outline="#121212", width=6)

    # Display font sizes
    f_brand  = find_font([DISPLAY_FONT], 110)
    f_sub    = find_font([DISPLAY_FONT], 38)
    f_tier   = find_font([DISPLAY_FONT], 80)
    f_price  = find_font([DISPLAY_FONT], 48)
    f_mono   = find_font([MONO_FONT, DISPLAY_FONT], 22)

    # Brand
    d.text((W//2, 220), "CSN SIGNATURE", fill="#121212", font=f_brand, anchor="mm")
    d.text((W//2, 320), "EVENTS - CHH. SAMBHAJINAGAR", fill="#121212", font=f_sub, anchor="mm")

    # Tier name + price
    d.text((W//2, 540), tier_name.upper(), fill="#121212", font=f_tier, anchor="mm")
    d.text((W//2, 640), f"Rs. {price:,}".replace(",", " X ").replace(" X ", ","), fill="#121212", font=f_price, anchor="mm")

    # QR zone (matches .env QR_TOP=920, QR_LEFT=380, QR_SIZE=320)
    qr_x, qr_y, qr_s = 380, 920, 320
    d.rectangle([qr_x, qr_y, qr_x+qr_s, qr_y+qr_s], fill="#FFFFFF", outline="#121212", width=6)
    d.text((qr_x + qr_s//2, qr_y + qr_s//2), "QR ZONE", fill="#B5AE9F", font=find_font([MONO_FONT], 28), anchor="mm")

    # Footer
    d.text((W//2, H-60), "Scan at venue gate - CSN Signature Events", fill="#121212", font=f_mono, anchor="mm")

    img.save(os.path.join(OUT_DIR, filename), "JPEG", quality=85)
    print(f"  -> {filename}  ({W}x{H})")

if __name__ == "__main__":
    print(f"Generating pass templates into {OUT_DIR}")
    for fn, tier, color, price in TIERS:
        make_template(fn, tier, color, price)
    print("Done.")
