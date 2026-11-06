import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQuerySpinner } from '../arca-query';
import { withSpinner } from '../spinner';

const stop = vi.fn();
const start = vi.fn(() => ({ stop }));

vi.mock('ora', () => ({ default: vi.fn(() => ({ start })) }));

const original = { columns: process.stdout.columns, isTTY: process.stdout.isTTY };

beforeEach(() => {
  stop.mockReset();
  start.mockClear();
  // El spinner solo se muestra en una terminal con ancho conocido.
  Object.assign(process.stdout, { columns: 80, isTTY: true });
});

afterEach(() => {
  Object.assign(process.stdout, original);
});

describe('withSpinner', () => {
  it('devuelve el resultado y detiene el spinner', async () => {
    await expect(withSpinner('Consultando ARCA...', async () => 42)).resolves.toBe(42);
    expect(start).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('detiene el spinner aunque la consulta falle', async () => {
    await expect(
      withSpinner('Consultando ARCA...', async () => {
        throw new Error('socket hang up');
      }),
    ).rejects.toThrow('socket hang up');
    expect(stop).toHaveBeenCalledOnce();
  });

  it('sin texto no hay spinner', async () => {
    await withSpinner(null, async () => undefined);
    expect(start).not.toHaveBeenCalled();
  });
});

describe('withQuerySpinner', () => {
  it('con --json no hay spinner: stderr queda limpio', async () => {
    await withQuerySpinner({ outputJson: true }, async () => undefined);
    expect(start).not.toHaveBeenCalled();
  });

  it('en texto muestra el spinner', async () => {
    await withQuerySpinner({ outputJson: false }, async () => undefined);
    expect(start).toHaveBeenCalledOnce();
  });
});
