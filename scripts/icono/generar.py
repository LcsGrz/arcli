"""Genera el ícono de ARCLI: el logo ASCII sobre un fondo con una onda de caracteres.

Escribe docs/assets/imagenes/arcliIcon.{svg,png} y assets/acceso-directo/arcli.{icns,ico,png}.
Necesita macOS (iconutil), rsvg-convert (`brew install librsvg`) y la fuente Menlo.

    python3 scripts/icono/generar.py
"""

import math
import shutil
import struct
import subprocess
import tempfile
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / 'docs/assets/imagenes'
ASSETS = ROOT / 'assets/acceso-directo'

# Copia textual de ARCLI_ASCII_BANNER (src/ui/primitives/renderLogo.ts); AR termina en la columna 23.
BANNER = [
    '       d8888 8888888b.   .d8888b.  888      8888888 ',
    '      d88888 888   Y88b d88P  Y88b 888        888   ',
    '     d88P888 888    888 888    888 888        888   ',
    '    d88P 888 888   d88P 888        888        888   ',
    '   d88P  888 8888888P"  888        888        888   ',
    '  d88P   888 888 T88b   888    888 888        888   ',
    ' d8888888888 888  T88b  Y88b  d88P 888        888   ',
    'd88P     888 888   T88b  "Y8888P"  88888888 8888888 ',
]
SPLIT, AR, CLI, FONT, RAMP = 23, '#74ACDF', '#FFFFFF', 'Menlo', ' .:-=+*#%@'
# Grilla de íconos de macOS: lienzo de 1024 con el cuadrado redondeado de 824 centrado.
CANVAS, BOX, RADIUS = 1024, 824, 185
ORIGIN = (CANVAS - BOX) / 2
LOGO_COLS, LOGO_ROWS = 52, 8
SAFE = 0.80  # el logo ocupa el 80% del ancho: 10% de margen por lado
CELL_RATIO = 28 / 15  # alto / ancho de una celda de la grilla de caracteres


def wave(row, col, rows, cols):
    """Devuelve (caracter, opacidad) de una celda del fondo."""
    x, y = col / cols * 7, row / rows * 7
    v = math.sin(x) + math.sin(y * 1.3 + x * 0.6) + math.sin(math.hypot(x - 3.5, y - 3.5) * 2)
    level = (v + 3) / 6
    return RAMP[min(len(RAMP) - 1, int(level * len(RAMP)))], 0.10 + 0.26 * level


def logo_svg(with_wave, full_bleed):
    """El ícono completo, o sin onda y sin margen exterior para 32 y 48 px."""
    lw = BOX * SAFE / LOGO_COLS
    lh = lw * CELL_RATIO
    cols, rows = int(BOX // lw) + 1, int(BOX // lh) + 1
    sx, sy = ORIGIN + (BOX - cols * lw) / 2, ORIGIN + (BOX - rows * lh) / 2
    col_shift, row_shift = (cols - LOGO_COLS) // 2, (rows - LOGO_ROWS) // 2
    lx0, ly0 = sx + col_shift * lw, sy + row_shift * lh
    glyphs = [(r, c, ch) for r, line in enumerate(BANNER) for c, ch in enumerate(line.rstrip()) if ch != ' ']
    view_box = f'{ORIGIN} {ORIGIN} {BOX} {BOX}' if full_bleed else f'0 0 {CANVAS} {CANVAS}'
    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{CANVAS}" height="{CANVAS}" viewBox="{view_box}">',
        '<defs><radialGradient id="fondo" cx="50%" cy="35%" r="70%"><stop offset="0" stop-color="#262637"/>'
        '<stop offset="1" stop-color="#181825"/></radialGradient>'
        f'<clipPath id="caja"><rect x="{ORIGIN}" y="{ORIGIN}" width="{BOX}" height="{BOX}" rx="{RADIUS}"/></clipPath></defs>',
        f'<rect x="{ORIGIN}" y="{ORIGIN}" width="{BOX}" height="{BOX}" rx="{RADIUS}" fill="url(#fondo)"/>',
        f'<g clip-path="url(#caja)" font-family="{FONT}" text-anchor="middle">',
    ]
    if with_wave:
        # La onda comparte la grilla del logo y deja libres sus celdas.
        taken = {(r + row_shift, c + col_shift) for r, c, _ in glyphs}
        out.append(f'<g font-size="{lw / 0.602:.2f}" fill="{AR}">')
        for row in range(rows):
            for col in range(cols):
                if (row, col) in taken:
                    continue
                ch, op = wave(row, col, rows, cols)
                if ch != ' ':
                    x, y = sx + (col + 0.5) * lw, sy + (row + 0.78) * lh
                    out.append(f'<text x="{x:.1f}" y="{y:.1f}" opacity="{op:.2f}">{escape(ch)}</text>')
        out.append('</g>')
    out.append(f'<g font-size="{lw / 0.602:.2f}" font-weight="bold">')
    for r, c, ch in glyphs:
        color = AR if c < SPLIT else CLI
        x, y = lx0 + (c + 0.5) * lw, ly0 + (r + 0.78) * lh
        out.append(f'<text x="{x:.1f}" y="{y:.1f}" fill="{color}">{escape(ch)}</text>')
    out.append('</g></g></svg>')
    return '\n'.join(out)


def ar_svg():
    """A 16 px el logo no se lee: solo "AR"."""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{CANVAS}" height="{CANVAS}" viewBox="0 0 {CANVAS} {CANVAS}">'
        '<rect width="1024" height="1024" rx="220" fill="#262637"/>'
        f'<text x="512" y="735" font-family="{FONT}" font-weight="bold" font-size="660" text-anchor="middle" fill="{AR}">AR</text></svg>'
    )


def png(svg, size, out):
    subprocess.run(['rsvg-convert', '-w', str(size), '-h', str(size), str(svg), '-o', str(out)], check=True)


def ico(entries, out):
    """Un .ico con imágenes PNG, que Windows acepta desde Vista."""
    data = [p.read_bytes() for _, p in entries]
    offset = 6 + 16 * len(entries)
    header = struct.pack('<HHH', 0, 1, len(entries))
    for (size, _), blob in zip(entries, data):
        header += struct.pack('<BBBBHHII', size % 256, size % 256, 0, 0, 1, 32, len(blob), offset)
        offset += len(blob)
    out.write_bytes(header + b''.join(data))


def main():
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        full, small, tiny = tmp / 'icono.svg', tmp / 'chico.svg', tmp / 'ar.svg'
        full.write_text(logo_svg(True, False), encoding='utf-8')
        small.write_text(logo_svg(False, True), encoding='utf-8')
        tiny.write_text(ar_svg(), encoding='utf-8')

        sources = {16: tiny, 32: small, 48: small, 64: full, 128: full, 256: full, 512: full}
        sizes = {}
        for size, svg in sources.items():
            sizes[size] = tmp / f'{size}.png'
            png(svg, size, sizes[size])

        iconset = tmp / 'arcli.iconset'
        iconset.mkdir()
        for name, size in [
            ('16x16', 16), ('16x16@2x', 32), ('32x32', 32), ('32x32@2x', 64), ('128x128', 128),
            ('128x128@2x', 256), ('256x256', 256), ('256x256@2x', 512), ('512x512', 512),
        ]:
            shutil.copy(sizes[size], iconset / f'icon_{name}.png')
        subprocess.run(['iconutil', '-c', 'icns', str(iconset), '-o', str(ASSETS / 'arcli.icns')], check=True)
        ico([(s, sizes[s]) for s in (256, 128, 64, 48, 32, 16)], ASSETS / 'arcli.ico')
        shutil.copy(sizes[512], ASSETS / 'arcli.png')

        shutil.copy(full, DOCS / 'arcliIcon.svg')
        png(full, CANVAS, DOCS / 'arcliIcon.png')


if __name__ == '__main__':
    main()
