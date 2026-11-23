/**
 * El reloj como dependencia: el nucleo no lee `new Date()`. Los servicios lo reciben y lo leen en cada operacion, nunca
 * al crearse, porque una sesion del asistente cruza la medianoche. Las funciones puras reciben la fecha ya leida.
 */
export interface Clock {
  now(): Date;
}
