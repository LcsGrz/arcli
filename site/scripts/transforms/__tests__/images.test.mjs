import { describe, expect, it } from 'vitest';

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
  const sizes = { '/assets/a.png': { height: 50, width: 200 } };
  const imageSize = (url) => sizes[url] ?? null;

  it('una imagen de Markdown pasa a <img> con su tamaño', () => {
    expect(sizedImages('![Captura](/assets/a.png)', { imageSize })).toBe(
      '<img src="/assets/a.png" alt="Captura" width="200" height="50" loading="lazy" decoding="async">',
    );
  });

  it('un <img> con ancho recibe el alto proporcional; sin ancho, los dos', () => {
    expect(sizedImages('<img src="/assets/a.png" alt="x" width="100">', { imageSize })).toBe(
      '<img src="/assets/a.png" alt="x" width="100" height="25">',
    );
    expect(sizedImages('<img src="/assets/a.png" alt="x">', { imageSize })).toBe(
      '<img src="/assets/a.png" alt="x" width="200" height="50">',
    );
  });

  it('deja igual lo que ya tiene alto o no se puede medir', () => {
    const input = '<img src="/assets/a.png" height="9">\n![x](/assets/otra.png)';

    expect(sizedImages(input, { imageSize })).toBe(input);
  });
});
