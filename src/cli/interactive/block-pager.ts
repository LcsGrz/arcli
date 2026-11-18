import { createPrompt, isEnterKey, makeTheme, useKeypress, usePrefix, useState } from '@inquirer/core';

/** Oculta el cursor de la terminal mientras se muestra el bloque; @inquirer lo vuelve a mostrar al cerrarlo. */
const CURSOR_HIDE = '\u001B[?25l';

export interface BlockPagerConfig<B extends string> {
  /** Los bloques en orden, de izquierda a derecha. */
  readonly blocks: readonly B[];
  /** Linea de ayuda de teclas, debajo del bloque. */
  readonly help: string;
  readonly message: string;
  /** El bloque ya dibujado (por ejemplo, un panel). */
  readonly render: (block: B) => string;
  readonly theme: {
    readonly prefix?: { readonly done: string; readonly idle: string };
    readonly style: { readonly message?: (text: string, status: string) => string };
  };
}

/**
 * Un contenido partido en bloques que se recorren con ← y →, como las columnas de la tabla del monotributo, que no
 * entran todas a lo ancho. Enter lo cierra; Esc tambien (lo maneja quien lo llama).
 */
export const blockPager = createPrompt(<B extends string>(config: BlockPagerConfig<B>, done: (value: B) => void) => {
  const theme = makeTheme(config.theme);
  const [status, setStatus] = useState<'done' | 'idle'>('idle');
  const [index, setIndex] = useState(0);
  const prefix = usePrefix({ status, theme });
  const block = config.blocks[index] ?? config.blocks[0];

  useKeypress((key) => {
    if (isEnterKey(key)) {
      setStatus('done');
      done(block as B);
    } else if (key.name === 'left') {
      setIndex(Math.max(0, index - 1));
    } else if (key.name === 'right') {
      setIndex(Math.min(config.blocks.length - 1, index + 1));
    }
  });

  const message = theme.style.message(config.message, status);

  if (status === 'done') {
    return [prefix, message].filter(Boolean).join(' ');
  }

  return `${[prefix, message].filter(Boolean).join(' ')}\n${config.render(block as B)}\n\n${config.help}${CURSOR_HIDE}`;
});
