import type { Clock } from '../../lib/time/clock';

/** El reloj del equipo. */
export const systemClock: Clock = { now: () => new Date() };
