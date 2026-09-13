/**
 * Sobrante mensual: el dinero que queda realmente libre al cerrar el mes.
 *
 * Que cuenta como «libre» y que no:
 *
 *   Reserva     NO. Su remanente ya va al Fondo de Ahorro.
 *   Inversion   NO. Su remanente ya se consolida en la Cartera.
 *   Esenciales  SI. Lo que no gastaste en vivir no tiene destino asignado.
 *   Recompensas SI. Lo que no te gastaste en caprichos tampoco.
 *
 * Es decir: el sobrante es exactamente lo que antes expiraba en silencio. En
 * vez de desaparecer, se mide, se avisa y se guarda en el historial.
 *
 * El importe del sobrante es un HECHO del mes y no cambia nunca. Lo que el
 * usuario haga despues con el —mandarlo a Inversion o a Reserva— se registra
 * aparte, como destino. Septiembre sobraron R$60 aunque luego los invirtiera.
 */

import { ESENCIALES, RECOMPENSAS, RESERVA, INVERSION, FONDO_AHORRO, CARTERA_INVERSION } from './buckets.js';
import { margen } from './periodo.js';
import { sumar } from './dinero.js';

/** Techos cuyo remanente se considera dinero libre. */
export const TECHOS_LIBRES = [ESENCIALES, RECOMPENSAS];

/**
 * @param {Object} periodo con techos y totales
 * @returns {{ sobranteCents, desglose, hay }}
 */
export function calcularSobrante(periodo) {
  const desglose = {};
  for (const b of TECHOS_LIBRES) {
    desglose[b] = Math.max(0, margen(periodo, b));
  }
  const sobranteCents = sumar(TECHOS_LIBRES.map((b) => desglose[b]));
  return { sobranteCents, desglose, hay: sobranteCents > 0 };
}

/** Registro persistible del sobrante de un mes. */
export function crearSobrante(periodo, ts = Date.now()) {
  const { sobranteCents, desglose } = calcularSobrante(periodo);
  return {
    periodId: periodo.id,
    sobranteCents,
    desglose,
    ingresoTotalCents: periodo.ingresoTotal ?? 0,
    calculadoEn: ts,
    // Lo que se hizo con el. Nunca modifica sobranteCents.
    destino: null,
    destinoCents: 0,
    resueltoEn: null,
  };
}

/** Destinos posibles para el sobrante ya registrado. */
export const DESTINOS_SOBRANTE = [
  { id: 'INVERSION', nombre: 'A la Cartera de Inversión', fondo: CARTERA_INVERSION },
  { id: 'RESERVA', nombre: 'Al Fondo de Ahorro', fondo: FONDO_AHORRO },
  { id: 'NADA', nombre: 'Dejarlo como está', fondo: null },
];

export function resolverSobrante(registro, destinoId, ts = Date.now()) {
  const destino = DESTINOS_SOBRANTE.find((d) => d.id === destinoId);
  if (!destino) throw new Error('SOBRANTE_DESTINO_DESCONOCIDO');

  return {
    ...registro,
    // sobranteCents NO se toca: es el hecho del mes.
    destino: destino.id,
    destinoCents: destino.fondo ? registro.sobranteCents : 0,
    resueltoEn: ts,
  };
}

/**
 * Sobrante proyectado del mes en curso, para avisar el dia antes del cierre.
 * En el ultimo dia del mes el margen que queda ES practicamente el final.
 */
export function sobranteProyectado(periodo) {
  return calcularSobrante(periodo);
}

/** Texto de la notificacion del dia previo al cierre (§11). */
export function textoAviso(sobranteCents, formatear) {
  return {
    titulo: 'Se acaba el mes',
    cuerpo: `Te han quedado ${formatear(sobranteCents)} libres este mes. Puedes invertirlos o destinarlos a tu reserva.`,
  };
}

/** ¿Es hoy el dia anterior al cierre? */
export function esVisperaDeCierre(fechaLocal, diasDelMes) {
  const dia = Number(fechaLocal.slice(8, 10));
  return dia === diasDelMes - 1 || dia === diasDelMes;
}

/** Historial ordenado del mas reciente al mas antiguo. */
export function ordenarHistorial(registros) {
  return [...registros].sort((a, b) => (a.periodId > b.periodId ? -1 : a.periodId < b.periodId ? 1 : 0));
}

/** Media de los ultimos n meses, para poner el mes actual en contexto. */
export function mediaSobrante(registros, n = 6) {
  const ultimos = ordenarHistorial(registros).slice(0, n);
  if (!ultimos.length) return 0;
  return Math.round(sumar(ultimos.map((r) => r.sobranteCents)) / ultimos.length);
}

export { ESENCIALES, RECOMPENSAS, RESERVA, INVERSION };
