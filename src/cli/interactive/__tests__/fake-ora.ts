/**
 * Un `ora` falso para `vi.mock('ora', ...)`: anota cada spinner y si sigue girando, sin escribir nada. Va aparte (sin
 * imports) porque lo carga el `vi.mock` antes que el resto del programa.
 */

interface FakeSpinner {
  isSpinning: boolean;
  text: string;
  stop: () => FakeSpinner;
}

const started: FakeSpinner[] = [];

export function fakeOra(): { default: (options: { readonly text?: string }) => { start: () => FakeSpinner } } {
  return {
    default: (options) => ({
      start: () => {
        const spinner: FakeSpinner = {
          isSpinning: true,
          stop: () => {
            spinner.isSpinning = false;

            return spinner;
          },
          text: options.text ?? '',
        };

        started.push(spinner);

        return spinner;
      },
    }),
  };
}

/** Los textos de los spinners que siguen girando. */
export function spinning(): string[] {
  return started.filter((spinner) => spinner.isSpinning).map((spinner) => spinner.text);
}

export function resetSpinners(): void {
  started.splice(0);
}
