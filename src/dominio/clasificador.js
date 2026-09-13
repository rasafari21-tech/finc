/**
 * Motor de clasificacion inflexible (§7).
 *
 * Evalua un movimiento contra las reglas por prioridad ascendente y devuelve
 * el veredicto de la primera coincidencia. Es una funcion pura: no toca disco,
 * no conoce la interfaz y puede ejecutarse miles de veces en un test.
 */

import { evaluar as evaluarPredicado, explicar } from './predicados.js';
import { componerReglas } from './reglas.js';
import { POR_ID as CATEGORIAS } from './categorias.js';

/**
 * @typedef {Object} Veredicto
 * @property {'OK'|'DENY'|'FORCE'|'WARN'|'REQUIRE_EVIDENCE'} tipo
 * @property {string} [ruleId]
 * @property {string} [mensaje]
 * @property {string} [porque]
 * @property {string[]} [explicacion] condiciones concretas que se cumplieron
 * @property {string} [bucketDestino]
 * @property {boolean} [anulable]
 */

const OK = { tipo: 'OK' };

/**
 * @param {Object} mov movimiento normalizado
 * @param {Object} ctx { categorias, periodo, fechaHoy, movimientosRecientes,
 *                       medianaImporte, periodosCerrados, reglasUsuario }
 * @returns {Veredicto}
 */
export function evaluarMovimiento(mov, ctx = {}) {
  const contexto = { categorias: CATEGORIAS, ...ctx };
  const reglas = ctx.reglasCompuestas ?? componerReglas(ctx.reglasUsuario);

  for (const regla of reglas) {
    if (!evaluarPredicado(regla.cuando, mov, contexto)) continue;

    // REQUIRE_EVIDENCE deja pasar si la prueba exigida esta presente.
    if (regla.accion === 'REQUIRE_EVIDENCE') {
      if (regla.satisfecho && evaluarPredicado(regla.satisfecho, mov, contexto)) continue;
      return {
        tipo: 'REQUIRE_EVIDENCE',
        ruleId: regla.id,
        mensaje: regla.mensaje,
        porque: regla.porque,
        requisitos: regla.requisitos ?? [],
        bucketDestino: regla.bucketDestino,
        explicacion: explicar(regla.cuando, mov, contexto),
        anulable: false,
      };
    }

    return {
      tipo: regla.accion,
      ruleId: regla.id,
      mensaje: regla.mensaje,
      porque: regla.porque,
      bucketDestino: regla.bucketDestino,
      explicacion: explicar(regla.cuando, mov, contexto),
      anulable: Boolean(regla.anulable),
    };
  }

  return OK;
}

/**
 * Sugerencia de categoria correcta (§7.4). Tres fuentes en cascada; la primera
 * que devuelve algo gana. El motor siempre sugiere: un rechazo sin salida
 * empuja al usuario a inventarse una etiqueta peor que la que intentaba poner.
 */
export function sugerirDestino(mov, veredicto, ctx = {}) {
  // 1 · el destino de la regla ya esta decidido
  if (veredicto?.bucketDestino) {
    return { bucket: veredicto.bucketDestino, fuente: 'regla' };
  }

  // 2 · historial del usuario para ese comercio o descripcion
  const historial = ctx.historialComercio?.[mov.comercio ?? ''];
  if (historial && historial.conteo >= 3) {
    return { bucket: historial.bucket, categoryId: historial.categoryId, fuente: 'historial' };
  }

  // 3 · catalogo base
  const cat = CATEGORIAS[mov.categoryId];
  if (cat?.defaultBucket) {
    return { bucket: cat.defaultBucket, categoryId: cat.id, fuente: 'catalogo' };
  }

  return null;
}

/**
 * Aplica el veredicto a un movimiento y dice si la escritura puede continuar.
 * Centraliza la politica para que los comandos no la reimplementen.
 *
 * @returns {{ permitido: boolean, mov: Object, veredicto: Veredicto, requiere?: string }}
 */
export function aplicarVeredicto(mov, veredicto, { justificacion, aceptaForzado } = {}) {
  switch (veredicto.tipo) {
    case 'OK':
      return { permitido: true, mov, veredicto };

    case 'FORCE':
      // Un FORCE no se aplica en silencio. Mover el gasto a Recompensas sin
      // decirlo dejaria al usuario creyendo que lo guardo en Esenciales, que
      // es justo el autoengaño que el motor existe para impedir. Se devuelve
      // el veredicto, la interfaz enseña la hoja (§7.3) y el usuario acepta.
      if (!aceptaForzado) {
        return { permitido: false, mov, veredicto, requiere: 'confirmar-destino' };
      }
      return {
        permitido: true,
        mov: { ...mov, bucket: veredicto.bucketDestino, bucketOriginal: mov.bucket },
        veredicto,
      };

    case 'WARN':
      if (justificacion && justificacion.trim().length >= 15) {
        return { permitido: true, mov: { ...mov, justificacion: justificacion.trim() }, veredicto };
      }
      return { permitido: false, mov, veredicto, requiere: 'justificacion' };

    case 'REQUIRE_EVIDENCE':
      return { permitido: false, mov, veredicto, requiere: 'evidencia' };

    case 'DENY':
      if (veredicto.anulable && justificacion && justificacion.trim().length >= 15) {
        return { permitido: true, mov: { ...mov, justificacion: justificacion.trim() }, veredicto };
      }
      return { permitido: false, mov, veredicto, requiere: veredicto.anulable ? 'justificacion' : null };

    default:
      return { permitido: true, mov, veredicto: OK };
  }
}

/** Mediana de importes, insumo de R-17. */
export function medianaDe(importes) {
  if (!importes.length) return 0;
  const orden = [...importes].sort((a, b) => a - b);
  const m = Math.floor(orden.length / 2);
  return orden.length % 2 ? orden[m] : Math.round((orden[m - 1] + orden[m]) / 2);
}
