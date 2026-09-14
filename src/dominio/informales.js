/**
 * Distribucion de ingresos informales.
 *
 * El ingreso mensual normal se reparte 50/25/15/10, como siempre. Esto es otra
 * cosa: los R$20 que entran a mitad de mes y que, si se quedan «libres», se
 * gastan solos. Ningun ingreso extraordinario queda suelto.
 *
 * El usuario elige a que techos va. Inversion y Reserva vienen marcados, que
 * es lo que se quiere casi siempre, pero se puede marcar cualquier
 * combinacion. Lo que entra se divide en partes iguales entre los marcados.
 *
 * Partes iguales, no ponderadas: es lo que una persona espera cuando marca dos
 * casillas. Marcas dos, mitad y mitad; marcas tres, un tercio cada uno. El
 * reparto 50/25/15/10 ya tiene su sitio, que es el ingreso mensual normal.
 */

import { ESENCIALES, INVERSION, RESERVA, RECOMPENSAS, ORDEN, ceros } from './buckets.js';
import { repartirRedondo } from './redondeo.js';
import { sumar } from './dinero.js';

/** Lo que viene marcado al abrir el modo ingreso. */
export const SELECCION_POR_DEFECTO = [INVERSION, RESERVA];

/**
 * Reparte 10.000 puntos basicos en partes iguales entre los techos marcados.
 * Tres partes no dan un numero redondo (3.333,33 cada una), asi que el resto
 * se coloca por orden canonico: el total siempre suma 10.000 exactos.
 */
export function pesosDeSeleccion(buckets) {
  const activos = ORDEN.filter((b) => buckets.includes(b));
  if (!activos.length) throw new Error('INFORMAL_SIN_SELECCION');

  const base = Math.floor(10_000 / activos.length);
  const pesos = ceros();
  for (const b of activos) pesos[b] = base;

  let resto = 10_000 - base * activos.length;
  for (const b of activos) {
    if (resto <= 0) break;
    pesos[b] += 1;
    resto -= 1;
  }
  return pesos;
}

/** Normaliza lo que llega de la interfaz: sin duplicados y en orden canonico. */
export function limpiarSeleccion(buckets) {
  const limpia = ORDEN.filter((b) => (buckets ?? []).includes(b));
  return limpia.length ? limpia : [...SELECCION_POR_DEFECTO];
}

/**
 * Cuanto le falta a cada techo para dejar de estar en rojo.
 * Ya no se usa para redirigir el dinero —manda lo que marque el usuario—,
 * pero la interfaz lo enseña en cada ficha para que decida con el dato.
 */
export function deficits(periodo) {
  const salida = ceros();
  for (const b of ORDEN) {
    salida[b] = Math.max(0, (periodo.totales?.[b] ?? 0) - (periodo.techos?.[b] ?? 0));
  }
  return salida;
}

/**
 * Resuelve el reparto de un ingreso informal entre los techos marcados.
 *
 * @param {number} importeCents
 * @param {Object} periodo periodo abierto
 * @param {Object} opciones
 * @param {string[]} opciones.buckets techos marcados; por defecto Inversion y Reserva
 */
export function distribuirInformal(importeCents, periodo, opciones = {}) {
  const seleccion = limpiarSeleccion(opciones.buckets);
  const pesos = pesosDeSeleccion(seleccion);

  // El prioritario se lleva el importe entero cuando no se puede fragmentar
  // en cantidades redondas. Reserva si esta marcada, y si no el primero.
  const prioritario = seleccion.includes(RESERVA) ? RESERVA : seleccion[0];
  const { partes, fragmentado, motivo } = repartirRedondo(importeCents, pesos, { prioritario });

  return { partes, seleccion, fragmentado, motivo, prioritario };
}

/** Vista previa para las fichas: cuanto tocaria a cada techo ahora mismo. */
export function previoDeSeleccion(importeCents, periodo, buckets) {
  if (!(importeCents > 0)) return null;
  try {
    return distribuirInformal(importeCents, periodo, { buckets }).partes;
  } catch {
    return null;
  }
}

/** Frase que explica que hizo el reparto, para enseñarla tras guardar. */
export function explicarReparto(resultado, formatear) {
  const { partes } = resultado;
  return ORDEN.filter((b) => partes[b] > 0)
    .map((b) => `${formatear(partes[b])} a ${b}`)
    .join(' y ');
}

export { ORDEN, INVERSION, RESERVA, ESENCIALES, RECOMPENSAS, sumar };
