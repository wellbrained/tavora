import re, io, sys
import resvg_py
from PIL import Image
SRC, OUT = sys.argv[1], sys.argv[2]
BG = "#1B1110"  # background of the approved original
def svg(name): return open(f"{SRC}/tavora-{name}.svg").read()
def content_bbox(name):
    s = svg(name); vb = list(map(float, re.search(r'viewBox="([^"]+)"', s).group(1).split()))
    z = 4
    im = Image.open(io.BytesIO(bytes(resvg_py.svg_to_bytes(svg_string=s, zoom=z))))
    l,t,r,b = im.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
    return vb[0]+l/z, vb[1]+t/z, vb[0]+r/z, vb[1]+b/z
def render(name, size, fill, bg, dy=0.0):
    """fill = share of the canvas the longer side of the artwork occupies."""
    l,t,r,b = content_bbox(name)
    side = max(r-l, b-t) / fill
    cx, cy = (l+r)/2, (t+b)/2 + dy*side
    s = svg(name)
    s = re.sub(r'viewBox="[^"]+"', f'viewBox="{cx-side/2:.3f} {cy-side/2:.3f} {side:.3f} {side:.3f}"', s, count=1)
    s = re.sub(r'(<svg[^>]*?)\swidth="[^"]+"', r'\1', s, count=1)
    s = re.sub(r'(<svg[^>]*?)\sheight="[^"]+"', r'\1', s, count=1)
    s = s.replace("<svg ", f'<svg width="{size}" height="{size}" ', 1)
    kw = dict(svg_string=s, width=size, height=size)
    if bg: kw["background"] = bg
    return Image.open(io.BytesIO(bytes(resvg_py.svg_to_bytes(**kw))))
variants = {
    # name: (svg, fill, background)
    "emblem-dark": ("emblem", 0.70, BG),   # fits inside a circular crop (Discord avatar)
    "lockup-dark": ("lockup", 0.84, BG),
    "flame-dark": ("flame", 0.72, BG),     # for tiny sizes / favicons
    "emblem-transparent": ("emblem", 0.86, None),
}
for v,(name,fill,bg) in variants.items():
    for size in (1024, 512, 256):
        im = render(name, size, fill, bg)
        if bg: im = im.convert("RGB")
        im.save(f"{OUT}/tavora-{v}-{size}.png", optimize=True)
        if bg and size == 1024:
            im.save(f"{OUT}/tavora-{v}-{size}.jpg", quality=95)
        print(v, size, im.size, im.mode)
