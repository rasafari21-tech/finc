/**
 * Distribucion de ingresos informales.
 *
 * El ingreso mensual normal se reparte 50/25/15/10, como siempre. Esto es otra
 * cosa: los R$20 que entran a mitad de mes y que, si se quedan «libres», se
 * gastan solos. Ningun ingreso extraordinario queda suelto.
 *
 * Dos comportamientos segun el tamaño:
 *   pequeño  -> mitad Inversion, mitad Reserva, sin preguntar nada
 *   grande   -> se pregunta como repartirlo, con tres opciones
 *
 * Y, por encima de todo, el reparto mira el estado real del mes: si un techo
 * ya esta en rojo, el dinero nuevo tapa ese agujero antes que nada.
 */

import { ESENCIALES, INVERSION, RESERVA, RECOMPENSAS, ORDEN, ceros } from './buckets.js';
import { repartirRedondo, objetivosAPesos } from './redondeo.js';
import { sumar } from './dinero.js';

export const MODO = {
  MITADES: 'MITADES',
  CUATRO: 'CUATRO',
  MANUAL: 'MANUAL',
};

/** A partir de aqui se pregunta en vez de decidir solo. */
export const UMBRAL_PREGUNTA = 5_000; // R$50

/** Mitad y mitad entre lo que construye futuro y lo que da colchon. */
export const PESOS_MITADES = {
  [ESENCIALES]: 0,
  [INVERSION]: 5_000,
  [RESERVA]: 5_000,
  [RECOMPENSAS]: 0,
};

export function requierePreguntar(importeCents, umbral = UMBRAL_PREGUNTA) {
  return importeCents >= umbral;
}

/**
 * Cuanto le falta a cada techo para dejar de estar en rojo.
 * Un techo rebasado es una deuda del mes consigo mismo, y es el primer sitio
 * al que debe ir el dinero que entra de mas.
 */
export function deficits(periodo) {
  const salida = ceros();
  for (const b of ORDEN) {
    salida[b] = Math.max(0, (periodo.totales?.[b] ?? 0) - (periodo.techos?.[b] ?? 0));
  }
  return salida;
}

/**
 * Calcula los pesos con los que repartir, mirando el estado del mes (§10).
 *
 * Sin techos en rojo, manda la distribucion elegida. Con techos en rojo, el
 * dinero tapa primero y solo reparte lo que sobre.
 */
export function pesosInteligentes(importeCents, periodo, pesosBase) {
  const d = deficits(periodo);
  const totalDeficit = sumar(ORDEN.map((b) => d[b]));

  if (totalDeficit === 0) {
    return { pesos: pesosBase, motivo: 'SIN_DEFICIT', deficits: d, totalDeficit };
  }

  if (importeCents <= totalDeficit) {
    return {
      pesos: objetivosAPesos(d) ?? pesosBase,
      motivo: 'TAPA_DEFICIT',
      deficits: d,
      totalDeficit,
      cubreDelDeficit: importeCents,
    };
  }

  // Tapa los agujeros y reparte el resto con los pesos elegidos.
  const sobra = importeCents - totalDeficit;
  const objetivos = ceros();
  for (const b of ORDEN) {
    objetivos[b] = d[b] + Math.round((sobra * (pesosBase[b] ?? 0)) / 10_000);
  }

  return {
    pesos: objetivosAPesos(objetivos) ?? pesosBase,
    motivo: 'TAPA_Y_REPARTE',
    deficits: d,
    totalDeficit,
    cubreDelDeficit: totalDeficit,
  };
}

/**
 * Resuelve el reparto completo de un ingreso informal.
 *
 * @param {number} importeCents
 * @param {Object} periodo periodo abierto, con techos y totales
 * @param {Object} opciones
 * @param {string} opciones.modo MODO.*  (por defecto MITADES)
 * @param {string} opciones.bucketManual obligatorio si modo es MANUAL
 * @param {Object} opciones.pesosBase pesos del periodo, para MODO.CUATRO
 * @param {boolean} opciones.inteligente mirar el estado del mes (por defecto si)
 */
export function distribuirInformal(importeCents, periodo, opciones = {}) {
  const {
    modo = MODO.MITADES,
    bucketManual = null,
    pesosBase = periodo?.pesos,
    inteligente = true,
  } = opciones;

  if (modo === MODO.MANUAL) {
    if (!ORDEN.includes(bucketManual)) throw new Error('INFORMAL_SIN_BUCKET_MANUAL');
    const partes = ceros();
    partes[bucketManual] = importeCents;
    return {
      partes,
      modo,
      fragmentado: false,
      motivo: 'ELECCION_MANUAL',
      explicacion: `Va entero a ${bucketManual}.`,
    };
  }

  const elegidos = modo === MODO.CUATRO ? pesosBase : PESOS_MITADES;

  const ajuste = inteligente
    ? pesosInteligentes(importeCents, periodo, elegidos)
    : { pesos: elegidos, motivo: 'SIN_DEFICIT', deficits: ceros(), totalDeficit: 0 };

  // Al tapar deficit el prioritario es el techo mas en rojo; si no, Reserva,
  // que es el destino por defecto de lo que no se puede partir.
  const prioritario =
    ajuste.totalDeficit > 0
      ? ORDEN.reduce((a, b) => (ajuste.deficits[b] > ajuste.deficits[a] ? b : a), ORDEN[0])
      : RESERVA;

  const { partes, fragmentado, motivo } = repartirRedondo(importeCents, ajuste.pesos, { prioritario });

  return {
    partes,
    modo,
    fragmentado,
    motivo,
    ajuste: ajuste.motivo,
    deficits: ajuste.deficits,
    totalDeficit: ajuste.totalDeficit,
    prioritario,
  };
}

/** Vista previa de las tres opciones, para la hoja de eleccion (§9). */
export function opcionesDeReparto(importeCents, periodo, pesosBase) {
  return [
    {
      id: MODO.MITADES,
      titulo: 'Reserva e Inversión',
      detalle: 'Mitad y mitad.',
      reparto: distribuirInformal(importeCents, periodo, { modo: MODO.MITADES, pesosBase }),
    },
    {
      id: MODO.CUATRO,
      titulo: 'Entre las cuatro',
      detalle: 'Con tu reparto habitual.',
      reparto: distribuirInformal(importeCents, periodo, { modo: MODO.CUATRO, pesosBase }),
    },
    {
      id: MODO.MANUAL,
      titulo: 'Lo elijo yo',
      detalle: 'Todo a un solo techo.',
      reparto: null,
    },
  ];
}

/** Frase que explica que hizo el reparto, para enseñarla tras guardar. */
export function explicarReparto(resultado, formatear) {
  const { partes, ajuste, totalDeficit } = resultado;
  const conDinero = ORDEN.filter((b) => partes[b] > 0);

  const lista = conDinero.map((b) => `${formatear(partes[b])} a ${b}`).join(' y ');

  if (ajuste === 'TAPA_DEFICIT') {
    return `${lista}. Iba todo a tapar lo que ya te habías pasado.`;
  }
  if (ajuste === 'TAPA_Y_REPARTE') {
    return `${lista}. Primero tapó ${formatear(totalDeficit)} de sobrepaso.`;
  }
  return lista;
}

export { ORDEN, INVERSION, RESERVA, ESENCIALES, RECOMPENSAS };
