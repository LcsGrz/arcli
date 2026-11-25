import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTaskQueue } from '../task-queue';

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Una tarea que termina cuando el test quiere. */
function held<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const task = vi.fn(
    () =>
      new Promise<T>((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
      }),
  );

  return { reject: (error: unknown) => reject(error), resolve: (value: T) => resolve(value), task };
}

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => {
  unhandled.push(reason);
};

beforeEach(() => {
  unhandled.length = 0;
  process.on('unhandledRejection', onUnhandled);
});

afterEach(() => {
  process.off('unhandledRejection', onUnhandled);
});

describe('createTaskQueue', () => {
  it('arranca hasta el tope y, al terminar una, la que sigue en la cola', async () => {
    const queue = createTaskQueue(2);
    const tasks = [held<string>(), held<string>(), held<string>(), held<string>()];
    const results = tasks.map(({ task }) => queue.add(task));
    const started = () => tasks.map(({ task }) => task.mock.calls.length);

    expect(started()).toEqual([1, 1, 0, 0]);

    tasks[1].resolve('b');
    await settle();
    expect(started()).toEqual([1, 1, 1, 0]);

    tasks[0].resolve('a');
    await settle();
    tasks[3].resolve('d');
    tasks[2].resolve('c');
    expect(await Promise.all(results)).toEqual(['a', 'b', 'c', 'd']);
    expect(started()).toEqual([1, 1, 1, 1]);
  });

  it('una que falla, también sin llegar a ser promesa, rechaza solo la suya y deja su lugar', async () => {
    const queue = createTaskQueue(1);
    const error = new Error('falló');
    const failed = queue.add(async () => {
      throw error;
    });
    const thrown = queue.add(() => {
      throw error;
    });

    expect(await queue.add(async () => 'sigue')).toBe('sigue');
    await expect(failed).rejects.toBe(error);
    await expect(thrown).rejects.toBe(error);
  });

  it('un rechazo que nadie espera no queda sin atender, y el que espera tarde lo recibe', async () => {
    const queue = createTaskQueue(2);
    const error = new Error('falló');
    const task = held<string>();
    const result = queue.add(task.task);

    void queue.add(async () => {
      throw error;
    });
    task.reject(error);
    await settle();
    expect(unhandled).toEqual([]);
    await expect(result).rejects.toBe(error);
  });

  it('stop: lo de la cola no arranca y se rechaza, lo que está en curso termina', async () => {
    const queue = createTaskQueue(1);
    const running = held<string>();
    const waiting = held<string>();
    const result = queue.add(running.task);
    const discarded = queue.add(waiting.task);

    queue.stop();
    await settle();

    const late = queue.add(waiting.task);

    running.resolve('terminó');
    expect(await result).toBe('terminó');
    await settle();
    expect(waiting.task).not.toHaveBeenCalled();
    expect(unhandled).toEqual([]);
    await expect(discarded).rejects.toThrow('se descartó');
    await expect(late).rejects.toThrow('se descartó');
  });
});
