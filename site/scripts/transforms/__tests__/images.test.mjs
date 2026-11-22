import { describe, expect, it } from 'vitest';

import { headerSize, toWebp } from '../../lib/images.mjs';
import { gifs } from '../gifs.mjs';
import { sizedImages } from '../sized-images.mjs';

describe('gifs', () => {
  it('un GIF solo en su linea pasa a una figura con leyenda', () => {
    expect(gifs('![Emitir una `factura`](/assets/demo/a.gif)')).toBe(
      '<figure class="arcli-gif"><img src="/assets/demo/a.gif" alt="Emitir una `factura`" loading="lazy"><figcaption>Emitir una <code>factura</code></figcaption></figure>',
    );
  });

  it('no toca un GIF en medio del texto ni un PNG', () => {
    const input = 'Mirá ![a](/assets/a.gif) acá.\n![b](/assets/b.png)';

    expect(gifs(input)).toBe(input);
  });
});

describe('sizedImages', () => {
  const sizes = { '/assets/a.png': { height: 50, width: 200 }, '/assets/c.webp': { height: 10, width: 40 } };
  const imageSize = (url) => sizes[url] ?? null;

  it('una imagen de Markdown pasa a <img> con su tamaño y en WebP', () => {
    expect(sizedImages('![Captura](/assets/a.png)', { imageSize })).toBe(
      '<img src="/assets/a.webp" alt="Captura" width="200" height="50" loading="lazy" decoding="async">',
    );
    expect(sizedImages('![Ya en WebP](/assets/c.webp)', { imageSize })).toBe(
      '<img src="/assets/c.webp" alt="Ya en WebP" width="40" height="10" loading="lazy" decoding="async">',
    );
  });

  it('un <img> con ancho recibe el alto proporcional; sin ancho, los dos', () => {
    expect(sizedImages('<img src="/assets/a.png" alt="x" width="100">', { imageSize })).toBe(
      '<img src="/assets/a.webp" alt="x" width="100" height="25">',
    );
    expect(sizedImages('<img src="/assets/a.png" alt="x">', { imageSize })).toBe(
      '<img src="/assets/a.webp" alt="x" width="200" height="50">',
    );
  });

  it('con alto solo pasa a WebP; lo que no se puede medir queda igual', () => {
    expect(sizedImages('<img src="/assets/a.png" height="9">', { imageSize })).toBe(
      '<img src="/assets/a.webp" height="9">',
    );
    expect(sizedImages('![x](/assets/otra.png)', { imageSize })).toBe('![x](/assets/otra.png)');
  });
});

describe('headerSize y toWebp', () => {
  const riff = (chunk, body) => {
    const head = Buffer.alloc(32);
    head.write('RIFF', 0, 'ascii');
    head.write('WEBP', 8, 'ascii');
    head.write(chunk, 12, 'ascii');
    body(head);

    return head;
  };

  it('lee el tamaño de un WebP con y sin pérdida, y del extendido (VP8X)', () => {
    expect(headerSize(riff('VP8 ', (h) => (h.writeUInt16LE(1349, 26), h.writeUInt16LE(632, 28))))).toEqual({
      height: 632,
      width: 1349,
    });
    expect(headerSize(riff('VP8L', (h) => h.writeUInt32LE((1349 - 1) | ((632 - 1) << 14), 21)))).toEqual({
      height: 632,
      width: 1349,
    });
    expect(headerSize(riff('VP8X', (h) => (h.writeUIntLE(1000 - 1, 24, 3), h.writeUIntLE(780 - 1, 27, 3))))).toEqual({
      height: 780,
      width: 1000,
    });
    expect(headerSize(Buffer.alloc(32))).toBeNull();
  });

  it('el PNG y el GIF pasan a su WebP; lo demás queda igual', () => {
    expect(toWebp('/assets/demo/a.gif')).toBe('/assets/demo/a.webp');
    expect(toWebp('/assets/b.png')).toBe('/assets/b.webp');
    expect(toWebp('/assets/c.svg')).toBe('/assets/c.svg');
  });
});
