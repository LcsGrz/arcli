import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runHistoryFlow } from '../history.flow';
import { runInteractiveMode } from '../interactive-mode';
import { runInvoiceFlow } from '../invoice.flow';
import { chooseOne } from '../prompts';

vi.mock('../prompts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../prompts')>()),
  chooseOne: vi.fn(),
}));
vi.mock('../invoice.flow', () => ({ runInvoiceFlow: vi.fn() }));
vi.mock('../note.flow', () => ({ runNoteFlow: vi.fn() }));
vi.mock('../history.flow', () => ({ runHistoryFlow: vi.fn() }));
vi.mock('../session', () => ({
  createInteractiveSession: () => ({ runtime: { environment: 'testing', pointOfSale: 3 } }),
}));

const chooseOneMock = vi.mocked(chooseOne);
const cancellation = () => Object.assign(new Error('cancelado'), { name: 'ExitPromptError' });

describe('runInteractiveMode', () => {
  let output = '';

  beforeEach(() => {
    output = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output += String(chunk);
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      output += String(chunk);
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('muestra la barra de estado y sale con "Salir"', async () => {
    chooseOneMock.mockResolvedValueOnce('salir');

    await runInteractiveMode();

    expect(output).toContain('MODO INTERACTIVO');
    expect(output).toContain('testing · PV 3');
    expect(output).toContain('¡Hasta la proxima!');
  });

  it('corre el flujo elegido y vuelve al menu', async () => {
    chooseOneMock.mockResolvedValueOnce('factura').mockResolvedValueOnce('historial').mockResolvedValueOnce('salir');

    await runInteractiveMode();

    expect(runInvoiceFlow).toHaveBeenCalledTimes(1);
    expect(runHistoryFlow).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+C dentro de un flujo cancela y vuelve al menu', async () => {
    vi.mocked(runInvoiceFlow).mockRejectedValueOnce(cancellation());
    chooseOneMock.mockResolvedValueOnce('factura').mockResolvedValueOnce('salir');

    await runInteractiveMode();

    expect(output).toContain('Cancelado. No se emitio nada.');
  });

  it('un error en un flujo se muestra y el menu sigue', async () => {
    vi.mocked(runInvoiceFlow).mockRejectedValueOnce(new Error('ARCA no responde'));
    chooseOneMock.mockResolvedValueOnce('factura').mockResolvedValueOnce('salir');

    await runInteractiveMode();

    expect(output).toContain('ARCA no responde');
    expect(chooseOneMock).toHaveBeenCalledTimes(2);
  });

  it('Ctrl+C en el menu sale', async () => {
    chooseOneMock.mockRejectedValueOnce(cancellation());

    await runInteractiveMode();

    expect(output).toContain('¡Hasta la proxima!');
  });
});
