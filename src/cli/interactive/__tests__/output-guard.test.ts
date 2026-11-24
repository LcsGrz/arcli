import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { stripAnsi } from '../../../ui';
import { outputState } from '../../closed-output';
import { assertOutputVisible, isAssistantRunning, withOutputGuard } from '../output-guard';
import { isPromptCancellation } from '../prompts';
import { showAssistantError } from '../show-assistant-error';

const streamError = (code: string) => Object.assign(new Error(`write ${code}`), { code });

let stderr = '';
let stdout = '';

beforeEach(() => {
  stderr = '';
  stdout = '';
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => ((stderr += String(chunk)), true));
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => ((stdout += String(chunk)), true));
});

afterEach(() => {
  vi.restoreAllMocks();
  outputState.closed.clear();
  outputState.failures.clear();
});

describe('assertOutputVisible', () => {
  it('con stdout sano sigue', async () => {
    await expect(withOutputGuard(assertOutputVisible)).resolves.toBeUndefined();
  });

  it('con stdout roto corta como un Ctrl+C', async () => {
    outputState.failures.set('stdout', streamError('ENOSPC'));

    const error: unknown = await withOutputGuard(assertOutputVisible).catch((caught: unknown) => caught);

    expect(isPromptCancellation(error)).toBe(true);
  });

  it('con un error que llega después de la última escritura, también', async () => {
    const guard = withOutputGuard(assertOutputVisible);

    process.nextTick(() => outputState.failures.set('stdout', streamError('EIO')));

    await expect(guard).rejects.toThrow();
  });

  it('si la cortaron (EPIPE), corta y queda como falla, para el aviso y el código', async () => {
    const closed = streamError('EPIPE');

    outputState.closed.set('stdout', closed);

    await expect(withOutputGuard(assertOutputVisible)).rejects.toThrow();
    expect(outputState.failures.get('stdout')).toBe(closed);
  });

  it('un EPIPE posterior no tapa el primer motivo', async () => {
    const first = streamError('ENOSPC');

    outputState.failures.set('stdout', first);
    outputState.closed.set('stdout', streamError('EPIPE'));

    await expect(withOutputGuard(assertOutputVisible)).rejects.toThrow();
    expect(outputState.failures.get('stdout')).toBe(first);
  });

  it('con solo stderr roto sigue preguntando', async () => {
    outputState.failures.set('stderr', streamError('ENOSPC'));

    await expect(withOutputGuard(assertOutputVisible)).resolves.toBeUndefined();
  });

  it('fuera del asistente (un comando con flags) no corta, tampoco después de uno que falló', async () => {
    outputState.failures.set('stdout', streamError('ENOSPC'));
    await withOutputGuard(() => Promise.reject(new Error('x'))).catch(() => undefined);

    expect(isAssistantRunning()).toBe(false);
    await expect(assertOutputVisible()).resolves.toBeUndefined();
  });
});

describe('showAssistantError', () => {
  it('con stderr sano va solo ahí', async () => {
    await showAssistantError(new Error('se rompió'));

    expect(stripAnsi(stderr)).toContain('se rompió');
    expect(stdout).toBe('');
  });

  it.each(['failures', 'closed'] as const)('con stderr perdido (%s) va solo a stdout', async (kind) => {
    outputState[kind].set('stderr', streamError('ENOSPC'));
    await showAssistantError(new Error('se rompió'));

    expect(stderr).toBe('');
    expect(stripAnsi(stdout)).toContain('se rompió');
  });

  it('si stderr falla con ese mismo error, se vuelve a mostrar en stdout', async () => {
    const shown = showAssistantError(new Error('se rompió'));

    process.nextTick(() => outputState.failures.set('stderr', streamError('ENOSPC')));
    await shown;

    expect(stripAnsi(stdout)).toContain('se rompió');
  });
});
