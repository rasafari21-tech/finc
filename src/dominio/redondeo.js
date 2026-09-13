/**
 * Reparto en cantidades redondas.
 *
 * El reparto al centavo de reparto.js es exacto, y para el ingreso mensual
 * normal es lo correcto. Para un ingreso informal de R$20 produce basura util
 * para nadie: R$3,27 + R$4,83 + R$2,91. Aqui el criterio cambia: antes que
 * repartir con precision, importa que cada parte sea una cantidad que una
 * persona pueda mover sin pensar.
 *
 * Tres reglas, en este orden:
 *   1. Si el importe no es un numero entero de unidades, no se fragmenta.
 *   2. Si no alcanza para que cada parte llegue al minimo, no se fragmenta.
 *   3. Si se fragmenta, se hace en unidades enteras, nunca en centavos.
 */

import { ORDEN, ceros } from './buckets.js';
import { repartir } from './reparto.js';
import { sumar } from './dinero.js';

/** Una unidad monetaria en centavos. Es el grano minimo de un reparto redondo. */
export const UNIDAD = 100;

/** Cada parte debe llegar al menos a esto, o no se reparte. */
export const MINIMO_POR_PARTE = 100; // R$1

/**
 * @param {number} importeCents entero positivo
 * @param {Object} pesos mapa bucket -> puntos basicos, suma 10.000
 * @param {Object} opciones
 * @param {string} opciones.prioritario bucket que se lleva todo si no se fragmenta
 * @returns {{ partes, fragmentado, motivo, unidades }}
 */
export function repartirRedondo(importeCents, pesos, { prioritario, minimoPorParte = MINIMO_POR_PARTE } = {}) {
  if (!Number.isInteger(importeCents) || importeCents <= 0) {
    throw new Error('REDONDEO_IMPORTE_INVALIDO');
  }

  const activos = ORDEN.filter((b) => (pesos[b] ?? 0) > 0);
  const destino = prioritario && (pesos[prioritario] ?? 0) > 0 ? prioritario : activos[0];

  const todoAUno = (motivo) => {
    const partes = ceros();
    partes[destino] = importeCents;
    return { partes, fragmentado: false, motivo, unidades: importeCents / UNIDAD };
  };

  if (activos.length === 0) throw new Error('REDONDEO_SIN_DESTINOS');
  if (activos.length === 1) return todoAUno('DESTINO_UNICO');

  // 1 · lo que no es una cantidad entera no se parte: los centavos sueltos
  //     solo pueden acabar en una parte fea, asi que se quedan juntos.
  if (importeCents % UNIDAD !== 0) return todoAUno('NO_ES_CANTIDAD_ENTERA');

  // 2 · partir R$3 entre cuatro no ayuda a nadie
  if (importeCents < activos.length * minimoPorParte) return todoAUno('DEMASIADO_PEQUENO');

  // 3 · reparto por resto mayor, pero contando en unidades en vez de centavos
  const unidades = importeCents / UNIDAD;
  const enUnidades = repartir(unidades, pesos);

  const partes = ceros();
  for (const b of ORDEN) partes[b] = enUnidades[b] * UNIDAD;

  if (sumar(ORDEN.map((b) => partes[b])) !== importeCents) {
    throw new Error('REDONDEO_DESCUADRADO');
  }

  return { partes, fragmentado: true, motivo: 'REPARTIDO', unidades };
}

/**
 * Convierte cantidades objetivo en pesos de puntos basicos.
 * Se usa para alimentar repartirRedondo desde un calculo de necesidades.
 */
export function objetivosAPesos(objetivos) {
  const total = sumar(ORDEN.map((b) => Math.max(0, objetivos[b] ?? 0)));
  if (total <= 0) return null;

  const crudos = ORDEN.map((b) => (Math.max(0, objetivos[b] ?? 0) * 10_000) / total);
  const base = crudos.map(Math.floor);
  let resto = 10_000 - sumar(base);

  const cola = crudos
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  for (let k = 0; resto > 0; k++, resto--) base[cola[k % cola.length].i] += 1;

  const pesos = {};
  ORDEN.forEach((b, i) => {
    pesos[b] = base[i];
  });
  return pesos;
}

/** Texto corto para explicar por que no se fragmento. */
export function explicarMotivo(motivo, moneda = 'R$') {
  switch (motivo) {
    case 'NO_ES_CANTIDAD_ENTERA':
      return `No es una cantidad redonda, así que va entera a un solo sitio en vez de partirse en céntimos.`;
    case 'DEMASIADO_PEQUENO':
      return `Es poco para repartir: partirlo daría trozos de menos de ${moneda}1.`;
    case 'DESTINO_UNICO':
      return 'Va entero al destino que elegiste.';
    default:
      return '';
  }
}
