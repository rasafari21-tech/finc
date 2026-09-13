/**
 * Destino del remanente al cerrar el mes (§8.3).
 *
 * Los cuatro acumulados vuelven a cero. A donde va lo que sobra es otra
 * pregunta, y se responde por bucket:
 *
 *   Esenciales   expira          (configurable -> Reserva)
 *   Inversion    Cartera         (configurable -> expira)
 *   Reserva      Fondo de Ahorro (FIJO, requisito del producto)
 *   Recompensas  expira          (FIJO, ver nota abajo)
 *
 * Recompensas expira siempre y a proposito: acumular presupuesto de capricho
 * convierte doce meses de moderacion en una compra impulsiva de diciembre con
 * coartada contable. Quien quiera ahorrar para un gasto grande de ocio tiene
 * la via correcta, que es el Fondo.
 */

import { ESENCIALES, INVERSION, RESERVA, RECOMPENSAS, ORDEN, FONDO_AHORRO, CARTERA_INVERSION } from './buckets.js';
import { margen } from './periodo.js';

export const EXPIRA = 'EXPIRA';

export const POLITICA_POR_DEFECTO = {
  [ESENCIALES]: EXPIRA,
  [INVERSION]: CARTERA_INVERSION,
  [RESERVA]: FONDO_AHORRO,
  [RECOMPENSAS]: EXPIRA,
};

/** Destinos que el usuario no puede cambiar. */
export const FIJOS = {
  [RESERVA]: FONDO_AHORRO,
  [RECOMPENSAS]: EXPIRA,
};

/** Destinos elegibles por bucket, para la pantalla de Ajustes. */
export const OPCIONES = {
  [ESENCIALES]: [EXPIRA, RESERVA],
  [INVERSION]: [CARTERA_INVERSION, EXPIRA],
  [RESERVA]: [FONDO_AHORRO],
  [RECOMPENSAS]: [EXPIRA],
};

/** Aplica los destinos fijos por encima de lo que diga la configuracion. */
export function normalizarPolitica(politica = {}) {
  return { ...POLITICA_POR_DEFECTO, ...politica, ...FIJOS };
}

/**
 * Calcula a donde va el remanente de cada techo al cerrar.
 * Funcion pura: no escribe nada, solo describe los movimientos a realizar.
 *
 * @returns {{ lineas: Array, aFondo: number, aCartera: number, expirado: number, sobrepasos: Array }}
 */
export function calcularCarry(periodo, politica = POLITICA_POR_DEFECTO) {
  const pol = normalizarPolitica(politica);
  const lineas = [];
  const sobrepasos = [];
  let aFondo = 0;
  let aCartera = 0;
  let expirado = 0;
  let aReservaSiguiente = 0;

  for (const bucket of ORDEN) {
    const restante = margen(periodo, bucket);

    if (restante < 0) {
      sobrepasos.push({ bucket, excesoCents: -restante });
      continue;
    }
    if (restante === 0) continue;

    const destino = pol[bucket];
    if (destino === FONDO_AHORRO) {
      aFondo += restante;
      lineas.push({ bucket, centavos: restante, destino: FONDO_AHORRO });
    } else if (destino === CARTERA_INVERSION) {
      aCartera += restante;
      lineas.push({ bucket, centavos: restante, destino: CARTERA_INVERSION });
    } else if (destino === RESERVA) {
      aReservaSiguiente += restante;
      lineas.push({ bucket, centavos: restante, destino: RESERVA });
    } else {
      expirado += restante;
      lineas.push({ bucket, centavos: restante, destino: EXPIRA });
    }
  }

  return { lineas, aFondo, aCartera, expirado, aReservaSiguiente, sobrepasos };
}

/** Texto legible del destino, para el informe y Ajustes. */
export function etiquetaDestino(destino) {
  switch (destino) {
    case FONDO_AHORRO:
      return 'Fondo de Ahorro';
    case CARTERA_INVERSION:
      return 'Cartera de Inversión';
    case RESERVA:
      return 'Reserva del mes siguiente';
    case EXPIRA:
      return 'expira';
    default:
      return destino;
  }
}
