#!/usr/bin/env python3
"""Regenerates apps/desktop/build/icon.{png,ico,icns} from the SVG sources beside them.

macOS only: needs Google Chrome, iconutil and Pillow.
"""
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
BUILD = Path(__file__).resolve().parent.parent / 'apps/desktop/build'
SMALL_MAX = 32
MAC_SMALL_SCALE = 0.88


def render(name, work):
    page = work / f'{name}.html'
    page.write_text(f'<!doctype html><body style="margin:0;background:transparent">{(BUILD / f"{name}.svg").read_text()}</body>')
    shot = work / f'{name}.png'
    subprocess.run(
        [CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
         '--default-background-color=00000000', '--window-size=1024,1024', f'--screenshot={shot}', page.as_uri()],
        check=True, stderr=subprocess.DEVNULL,
    )
    return Image.open(shot).convert('RGBA').crop((0, 0, 1024, 1024))


def resized(art, size):
    return art.resize((size, size), Image.LANCZOS)


def mac_small(art, size):
    inner = round(size * MAC_SMALL_SCALE)
    tile = Image.new('RGBA', (size, size))
    tile.paste(resized(art, inner), ((size - inner) // 2, (size - inner) // 2))
    return tile


with tempfile.TemporaryDirectory() as tmp:
    work = Path(tmp)
    mac, win, small = (render(name, work) for name in ('icon', 'icon-windows', 'icon-small'))

    resized(win, 512).save(BUILD / 'icon.png')

    sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
    frames = [resized(small if size <= SMALL_MAX else win, size) for size in sizes]
    frames[-1].save(BUILD / 'icon.ico', format='ICO', sizes=[(s, s) for s in sizes], append_images=frames[:-1])

    iconset = work / 'icon.iconset'
    iconset.mkdir()
    for base in (16, 32, 128, 256, 512):
        for scale, suffix in ((1, ''), (2, '@2x')):
            size = base * scale
            image = mac_small(small, size) if size <= SMALL_MAX else resized(mac, size)
            image.save(iconset / f'icon_{base}x{base}{suffix}.png')
    subprocess.run(['iconutil', '-c', 'icns', str(iconset), '-o', str(work / 'icon.icns')], check=True)
    shutil.copyfile(work / 'icon.icns', BUILD / 'icon.icns')
