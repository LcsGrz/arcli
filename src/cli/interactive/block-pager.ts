import { createPrompt, isEnterKey, makeTheme, useKeypress, usePrefix, useState } from '@inquirer/core';

/** Oculta el cursor de la terminal mientras se muestra el bloque; @inquirer lo vuelve a mostrar al cerrarlo. */
const CURSOR_HIDE = '\u001B[?25l';

export type BlockPagerDirection = 'left' | 'right';

/**
 * Vistas adentro de cada bloque, como las columnas de una tabla que no entran todas: ←/→ las recorren y, en la
 * ultima (o la primera), pasan al bloque de al lado.
 */
export interface BlockPagerViews<B extends string, V> {
  /** La vista con la que se entra a `block` desde `side` (el bloque de la izquierda o el de la derecha). */
  readonly enter: (block: B, side: BlockPagerDirection) => V | undefined;
  /** La vista siguiente hacia `direction`, o `undefined` si ya no hay mas en ese bloque. */
  readonly move: (block: B, view: V, direction: BlockPagerDirection) => V | undefined;
}

export interface BlockPagerConfig<B extends string, V = never> {
  /** Los bloques en orden, de izquierda a derecha. */
  readonly blocks: readonly B[];
  /** Linea de ayuda de teclas, debajo del bloque. */
  readonly help: string;
  readonly message: string;
  /** El bloque ya dibujado (por ejemplo, un panel), en su vista si las tiene. */
  readonly render: (block: B, view?: V) => string;
  readonly theme: {
    readonly prefix?: { readonly done: string; readonly idle: string };
    readonly style: { readonly message?: (text: string, status: string) => string };
  };
  readonly views?: BlockPagerViews<B, V>;
}

interface Position<V> {
  readonly index: number;
  readonly view: V | undefined;
}

/**
 * Un contenido partido en bloques que se recorren con ← y →, como las columnas de la tabla del monotributo, que no
 * entran todas a lo ancho. Con `views`, cada bloque se recorre por dentro antes de pasar al siguiente. Enter lo
 * cierra; Esc tambien (lo maneja quien lo llama).
 */
export const blockPager = createPrompt(
  <B extends string, V = never>(config: BlockPagerConfig<B, V>, done: (value: B) => void) => {
    const theme = makeTheme(config.theme);
    const [status, setStatus] = useState<'done' | 'idle'>('idle');
    const [position, setPosition] = useState<Position<V>>(() => ({
      index: 0,
      view: config.blocks[0] === undefined ? undefined : config.views?.enter(config.blocks[0], 'left'),
    }));
    const prefix = usePrefix({ status, theme });
    const block = (config.blocks[position.index] ?? config.blocks[0]) as B;

    const step = (direction: BlockPagerDirection): Position<V> | undefined => {
      const inside =
        config.views && position.view !== undefined ? config.views.move(block, position.view, direction) : undefined;

      if (inside !== undefined) {
        return { index: position.index, view: inside };
      }

      const index = position.index + (direction === 'right' ? 1 : -1);
      const next = config.blocks[index];

      if (next === undefined) {
        return undefined;
      }

      return { index, view: config.views?.enter(next, direction === 'right' ? 'left' : 'right') };
    };

    useKeypress((key) => {
      if (isEnterKey(key)) {
        setStatus('done');
        done(block);
      } else if (key.name === 'left' || key.name === 'right') {
        const next = step(key.name);

        // En los bordes la tecla no cambia nada: no se vuelve a dibujar.
        if (next) {
          setPosition(next);
        }
      }
    });

    const message = theme.style.message(config.message, status);

    if (status === 'done') {
      return [prefix, message].filter(Boolean).join(' ');
    }

    return `${[prefix, message].filter(Boolean).join(' ')}\n${config.render(block, position.view)}\n\n${config.help}${CURSOR_HIDE}`;
  },
);
