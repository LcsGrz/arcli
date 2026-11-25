import { EventEmitter } from 'node:events';
import { Agent, type RequestOptions } from 'node:https';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requestNpmRegistry } from '../npm-registry';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('node:https', async (importOriginal) => ({ ...(await importOriginal<typeof import('node:https')>()), get }));

const URL = 'https://registry.npmjs.org/arcli/latest';

function answer(statusCode: number, body: readonly string[]): void {
  get.mockImplementationOnce((_url: string, _options: RequestOptions, onResponse: (response: object) => void) => {
    setImmediate(() => onResponse(Object.assign(Readable.from(body.map((part) => Buffer.from(part))), { statusCode })));

    return new EventEmitter();
  });
}

describe('requestNpmRegistry', () => {
  beforeEach(() => get.mockReset());

  it('lee el JSON y pasa la señal, que corta la conexión', async () => {
    const { signal } = new AbortController();

    answer(200, ['{"version":', '"9.0.0"}']);

    const response = await requestNpmRegistry(URL, { signal });

    expect(response.ok).toBe(true);
    expect(await response.json()).toEqual({ version: '9.0.0' });
    expect(get).toHaveBeenCalledWith(URL, { agent: expect.any(Agent) as Agent, signal }, expect.any(Function));
  });

  it.each([199, 300, 304, 404, 500])('con un %s no está ok', async (status) => {
    answer(status, ['']);

    expect((await requestNpmRegistry(URL, { signal: new AbortController().signal })).ok).toBe(false);
  });

  it('una respuesta que no es JSON falla al leerla', async () => {
    answer(200, ['<html>']);

    const response = await requestNpmRegistry(URL, { signal: new AbortController().signal });

    await expect(response.json()).rejects.toThrow();
  });

  it('una falla al conectar o al leer rechaza', async () => {
    get.mockImplementationOnce(() => {
      const request = new EventEmitter();

      setImmediate(() => request.emit('error', new Error('sin red')));

      return request;
    });
    await expect(requestNpmRegistry(URL, { signal: new AbortController().signal })).rejects.toThrow('sin red');

    get.mockImplementationOnce((_url: string, _options: RequestOptions, onResponse: (response: object) => void) => {
      const response = new Readable({ read: () => undefined });

      setImmediate(() => {
        onResponse(Object.assign(response, { statusCode: 200 }));
        response.destroy(new Error('cortada'));
      });

      return new EventEmitter();
    });
    await expect(requestNpmRegistry(URL, { signal: new AbortController().signal })).rejects.toThrow('cortada');
  });
});
