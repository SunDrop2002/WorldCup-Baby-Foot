#!/usr/bin/env python3
"""
upscale.py — make a picture bigger and sharper.

Two modes:
  * fast  (default) : high-quality Lanczos resampling + smart sharpening.
                      No downloads, works offline. Great for clean images
                      you just want larger and crisper.
  * ai              : Real-ESRGAN neural super-resolution. Actually
                      reconstructs detail and removes blur. Needs the
                      'realesrgan' package (see notes at the bottom).

Usage:
    python upscale.py photo.jpg
    python upscale.py photo.jpg -o big.jpg -s 4
    python upscale.py photo.jpg --mode ai -s 4
    python upscale.py photo.jpg --sharpen 1.5

Requirements (fast mode):
    pip install pillow
"""

import argparse
import sys
from pathlib import Path

try:
    from PIL import Image, ImageFilter
except ImportError:
    sys.exit("Pillow is not installed. Run:  pip install pillow")


def upscale_fast(img: Image.Image, scale: float, sharpen: float) -> Image.Image:
    """Enlarge with Lanczos, then apply an unsharp mask to restore crispness."""
    new_size = (round(img.width * scale), round(img.height * scale))
    img = img.resize(new_size, Image.LANCZOS)

    if sharpen > 0:
        # radius/threshold tuned for upscaled photos; percent scales with --sharpen
        img = img.filter(
            ImageFilter.UnsharpMask(
                radius=2,
                percent=int(80 * sharpen),
                threshold=2,
            )
        )
    return img


def upscale_ai(img: Image.Image, scale: int) -> Image.Image:
    """Real-ESRGAN super-resolution. Requires: pip install realesrgan basicsr."""
    try:
        import numpy as np
        from realesrgan import RealESRGANer
        from basicsr.archs.rrdbnet_arch import RRDBNet
    except ImportError:
        sys.exit(
            "AI mode needs extra packages. Install with:\n"
            "    pip install realesrgan basicsr torch\n"
            "Or just use the default fast mode (drop --mode ai)."
        )

    model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64,
                    num_block=23, num_grow_ch=32, scale=4)
    upsampler = RealESRGANer(
        scale=4,
        model_path="https://github.com/xinntao/Real-ESRGAN/releases/download/"
                   "v0.1.0/RealESRGAN_x4plus.pth",
        model=model,
        half=False,          # set True if you have a CUDA GPU, for speed
    )

    rgb = np.array(img.convert("RGB"))[:, :, ::-1]     # PIL RGB -> OpenCV BGR
    output, _ = upsampler.enhance(rgb, outscale=scale)
    return Image.fromarray(output[:, :, ::-1])          # BGR -> RGB


def main():
    p = argparse.ArgumentParser(description="Upscale and sharpen an image.")
    p.add_argument("input", help="path to the image to upscale")
    p.add_argument("-o", "--output", help="output path (default: <name>_upscaled.<ext>)")
    p.add_argument("-s", "--scale", type=float, default=2.0,
                   help="scale factor, e.g. 2 = double the size (default: 2)")
    p.add_argument("--mode", choices=["fast", "ai"], default="fast",
                   help="'fast' (default) or 'ai' Real-ESRGAN super-resolution")
    p.add_argument("--sharpen", type=float, default=1.0,
                   help="fast-mode sharpening strength, 0 = none (default: 1.0)")
    args = p.parse_args()

    src = Path(args.input)
    if not src.exists():
        sys.exit(f"File not found: {src}")

    img = Image.open(src)

    if args.mode == "ai":
        result = upscale_ai(img, int(args.scale))
    else:
        result = upscale_fast(img, args.scale, args.sharpen)

    if args.output:
        out = Path(args.output)
    else:
        out = src.with_name(f"{src.stem}_upscaled{src.suffix}")

    # Preserve JPEG quality; keep original format otherwise.
    save_kwargs = {}
    if out.suffix.lower() in {".jpg", ".jpeg"}:
        save_kwargs = {"quality": 95, "subsampling": 0}
        result = result.convert("RGB")

    result.save(out, **save_kwargs)
    print(f"Saved {out}  ({img.width}x{img.height} -> {result.width}x{result.height})")


if __name__ == "__main__":
    main()
