/**
 * Periodos mensuales y frontera de fecha local (§5).
 *
 * Regla que no se negocia: el periodId deriva de la fecha LOCAL del usuario,
 * nunca de la marca de tiempo UTC. Sin esta separacion, un gasto a las 23:40
 * del 31 de agosto en UTC-5 caeria en septiembre y descuadraria dos cierres.
 */

import { ORDEN, ceros, PESOS_POR_DEFECTO } from './buckets.js';

/**
 * Fecha local en formato YYYY-MM-DD para una marca de tiempo y una zona.
 * Se arma desde formatToParts en vez de confiar en el formato de un locale.
 */
export function fechaLocal(ts, zona) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ts));

  const g = (tipo) => partes.find((p) => p.type === tipo)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}`;
}

/** Hora local HH:MM, util para la bitacora. */
export function horaLocal(ts, zona) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zona,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ts));
  const g = (tipo) => partes.find((p) => p.type === tipo)?.value ?? '';
  return `${g('hour')}:${g('minute')}`;
}

/** periodId YYYY-MM a partir de una fecha local YYYY-MM-DD. */
export function periodoDeFecha(fecha) {
  return fecha.slice(0, 7);
}

/** periodId a partir de una marca de tiempo y una zona. */
export function periodoDe(ts, zona) {
  return periodoDeFecha(fechaLocal(ts, zona));
}

/** Dia del mes (1-31) a partir de una fecha local. */
export function diaDeFecha(fecha) {
  return Number(fecha.slice(8, 10));
}

export function siguientePeriodo(periodId) {
  const [a, m] = periodId.split('-').map(Number);
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
}

export function anteriorPeriodo(periodId) {
  const [a, m] = periodId.split('-').map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
}

/** Numero de dias del mes de un periodo. */
export function diasEnPeriodo(periodId) {
  const [a, m] = periodId.split('-').map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

/** Nombre legible del periodo, p.ej. "septiembre de 2026". */
export function nombrePeriodo(periodId) {
  const [a, m] = periodId.split('-').map(Number);
  const meses = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ];
  return `${meses[m - 1]} de ${a}`;
}

/** Compara dos periodId lexicograficamente, que para YYYY-MM equivale a cronologico. */
export function comparaPeriodos(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Crea un periodo abierto en limpio.
 * Los techos arrancan a cero: se llenan con la Base Fija y con cada ingreso.
 */
export function crearPeriodo(periodId, { pesos = PESOS_POR_DEFECTO, topes = {}, abiertoEn } = {}) {
  return {
    id: periodId,
    status: 'abierto',
    abiertoEn: abiertoEn ?? Date.now(),
    cerradoEn: null,
    pesos: { ...pesos },
    topes: { ...topes },
    techos: ceros(),
    totales: ceros(),
    ingresoTotal: 0,
    baseFijaAplicada: false,
    carryIn: 0,
    carryOut: 0,
    sinRegistrar: 0,
    recalcHash: null,
  };
}

/** Margen disponible de un techo. Negativo significa sobrepaso. */
export function margen(periodo, bucket) {
  return (periodo.techos[bucket] ?? 0) - (periodo.totales[bucket] ?? 0);
}

/** Utilizacion de un techo en tanto por uno. Sin techo devuelve 0. */
export function utilizacion(periodo, bucket) {
  const techo = periodo.techos[bucket] ?? 0;
  if (techo <= 0) return 0;
  return (periodo.totales[bucket] ?? 0) / techo;
}

/**
 * Recalcula techos y totales de un periodo desde su lista de movimientos.
 *
 * Es la red de seguridad del agregado materializado (AD-05): el cierre lo
 * ejecuta y compara con lo guardado. Si divergen, gana este resultado.
 */
export function recalcularTotales(periodo, movimientos, asignaciones) {
  const techos = ceros();
  const totales = ceros();
  let ingresoTotal = 0;
  let sinRegistrar = 0;

  for (const a of asignaciones) {
    if (techos[a.bucket] !== undefined) techos[a.bucket] += a.centavos;
  }

  for (const m of movimientos) {
    if (m.tipo === 'ingreso') {
      ingresoTotal += m.importeCents;
    } else if (m.bucket === 'SIN_REGISTRAR') {
      sinRegistrar += m.importeCents;
    } else if (totales[m.bucket] !== undefined) {
      totales[m.bucket] += m.importeCents;
    }
  }

  return { ...periodo, techos, totales, ingresoTotal, sinRegistrar };
}

/**
 * Proyeccion a fin de mes de un techo: gasto diario medio por dias restantes.
 * Lo usa la hoja de detalle del panel y la notificacion del dia 20.
 */
export function proyeccion(periodo, bucket, fechaHoy) {
  const dia = diaDeFecha(fechaHoy);
  const dias = diasEnPeriodo(periodo.id);
  const gastado = periodo.totales[bucket] ?? 0;
  if (dia <= 0) return gastado;
  const medioDiario = gastado / dia;
  return Math.round(medioDiario * dias);
}

/** Posicion del dia actual dentro del mes, en tanto por uno. Es la marca de ritmo. */
export function ritmo(periodId, fechaHoy) {
  const dia = diaDeFecha(fechaHoy);
  const dias = diasEnPeriodo(periodId);
  return Math.min(1, dia / dias);
}

export { ORDEN };
