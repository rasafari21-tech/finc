/**
 * Diagnostico de subfinanciamiento estructural (§9).
 *
 * Un mes con Esenciales al 108 % es un mal mes. Cuatro de los ultimos seis por
 * encima del 95 % no son mala suerte: son una regla porcentual mal calibrada
 * para la realidad de esa persona. Esto distingue ambas cosas.
 */

import { ESENCIALES, INVERSION, RESERVA, RECOMPENSAS } from './buckets.js';
import { razon } from './dinero.js';

export const VENTANA = 6;
export const MINIMO_PERIODOS = 3;

/** Orden de recorte y suelo de cada bucket, en puntos porcentuales. */
export const ORDEN_RECORTE = [
  { bucket: RECOMPENSAS, suelo: 5 },
  { bucket: INVERSION, suelo: 10 },
  { bucket: RESERVA, suelo: 10 },
];

/** Percentil por interpolacion lineal. */
export function percentil(valores, p) {
  if (!valores.length) return 0;
  const orden = [...valores].sort((a, b) => a - b);
  if (orden.length === 1) return orden[0];
  const pos = (p / 100) * (orden.length - 1);
  const bajo = Math.floor(pos);
  const alto = Math.ceil(pos);
  if (bajo === alto) return orden[bajo];
  return orden[bajo] + (orden[alto] - orden[bajo]) * (pos - bajo);
}

/** Pendiente de la regresion lineal por minimos cuadrados. */
export function pendiente(valores) {
  const n = valores.length;
  if (n < 2) return 0;
  const mediaX = (n - 1) / 2;
  const mediaY = valores.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  valores.forEach((y, x) => {
    num += (x - mediaX) * (y - mediaY);
    den += (x - mediaX) ** 2;
  });
  return den === 0 ? 0 : num / den;
}

/**
 * Evalua las tres señales sobre los ultimos periodos cerrados.
 *
 * @param {Array} periodosCerrados en orden cronologico, el ultimo al final
 * @returns {{ severidad, señal, utilizaciones, propuesta } | null}
 */
export function diagnosticar(periodosCerrados) {
  const ventana = periodosCerrados.slice(-VENTANA);
  if (ventana.length < MINIMO_PERIODOS) return null;

  const utilizaciones = ventana.map((p) => razon(p.totales?.[ESENCIALES] ?? 0, p.techos?.[ESENCIALES] ?? 0));

  const rebasados = utilizaciones.filter((u) => u > 1.0).length;
  const alLimite = utilizaciones.filter((u) => u >= 0.95).length;
  const tendencia = pendiente(utilizaciones);
  const ultimo = utilizaciones[utilizaciones.length - 1] ?? 0;

  let severidad = null;
  let señal = null;
  if (rebasados >= 3) {
    severidad = 'CRITICA';
    señal = 'S1';
  } else if (alLimite >= 4) {
    severidad = 'ALTA';
    señal = 'S2';
  } else if (tendencia >= 0.04 && ultimo >= 0.9) {
    severidad = 'TENDENCIA';
    señal = 'S3';
  }

  if (!severidad) return null;

  const pesosActuales = ventana[ventana.length - 1]?.pesos ?? null;
  const propuesta = proponerRebalanceo(ventana, pesosActuales);

  return {
    señal,
    severidad,
    periodos: ventana.map((p) => p.id),
    utilizaciones,
    rebasados,
    alLimite,
    tendencia,
    propuesta,
  };
}

/**
 * Calcula el porcentaje sugerido para Esenciales y de donde sale el delta.
 *
 * Percentil 75, no media: un solo mes atipico distorsiona la media, y el
 * maximo sobredimensiona. Reserva se recorta en ultimo lugar y con suelo,
 * porque quien tiene Esenciales estructuralmente subfinanciados es justo
 * quien mas va a necesitar el colchon.
 */
export function proponerRebalanceo(periodos, pesosActuales = null) {
  const ratios = periodos
    .filter((p) => (p.ingresoTotal ?? 0) > 0)
    .map((p) => razon(p.totales?.[ESENCIALES] ?? 0, p.ingresoTotal));

  if (!ratios.length) return null;

  const bruto = Math.ceil(percentil(ratios, 75) * 100);
  const nuevoEsenciales = Math.max(50, Math.min(70, bruto));

  const actual = pesosActuales
    ? {
        [ESENCIALES]: Math.round(pesosActuales[ESENCIALES] / 100),
        [INVERSION]: Math.round(pesosActuales[INVERSION] / 100),
        [RESERVA]: Math.round(pesosActuales[RESERVA] / 100),
        [RECOMPENSAS]: Math.round(pesosActuales[RECOMPENSAS] / 100),
      }
    : { [ESENCIALES]: 50, [INVERSION]: 25, [RESERVA]: 15, [RECOMPENSAS]: 10 };

  let delta = nuevoEsenciales - actual[ESENCIALES];
  if (delta <= 0) return null;

  const propuesto = { ...actual, [ESENCIALES]: nuevoEsenciales };
  const recortes = [];

  for (const { bucket, suelo } of ORDEN_RECORTE) {
    if (delta <= 0) break;
    const disponible = Math.max(0, propuesto[bucket] - suelo);
    const recorte = Math.min(disponible, delta);
    if (recorte > 0) {
      propuesto[bucket] -= recorte;
      recortes.push({ bucket, puntos: recorte });
      delta -= recorte;
    }
  }

  // Si no cabe respetando los suelos, el problema no es de reparto.
  const viable = delta === 0;
  if (!viable) {
    return {
      viable: false,
      nuevoEsenciales,
      faltanPuntos: delta,
      actual,
      ratioReal: percentil(ratios, 75),
    };
  }

  return {
    viable: true,
    actual,
    propuesto,
    recortes,
    nuevoEsenciales,
    ratioReal: percentil(ratios, 75),
    pesosBps: {
      [ESENCIALES]: propuesto[ESENCIALES] * 100,
      [INVERSION]: propuesto[INVERSION] * 100,
      [RESERVA]: propuesto[RESERVA] * 100,
      [RECOMPENSAS]: propuesto[RECOMPENSAS] * 100,
    },
  };
}

/** Texto de la alerta, listo para el banner y el informe (§9.3). */
export function redactarAlerta(dx) {
  if (!dx) return null;
  const pct = (u) => `${Math.round(u * 100)} %`;
  const serie = dx.utilizaciones.map(pct).join(', ');

  if (!dx.propuesta?.viable) {
    return {
      titular: 'Tu 50 % de Esenciales no alcanza, y recortar no basta.',
      evidencia: `Lo rebasaste en ${dx.rebasados} de los últimos ${dx.utilizaciones.length} meses: ${serie}.`,
      diagnostico:
        'Ni recortando Recompensas e Inversión hasta el suelo se cubre tu gasto esencial real. Esto no se arregla repartiendo distinto: o sube el ingreso, o baja un coste fijo.',
      accionPrimaria: 'Ver mis Esenciales',
      accionSecundaria: 'Entendido',
    };
  }

  const p = dx.propuesta;
  return {
    titular: 'Tu 50 % de Esenciales no alcanza.',
    evidencia: `Lo rebasaste en ${dx.rebasados} de los últimos ${dx.utilizaciones.length} meses: ${serie}.`,
    diagnostico: `Tu gasto esencial real ronda el ${Math.round(p.ratioReal * 100)} % de lo que ingresas. La regla, no tu comportamiento, es lo que está mal calibrado.`,
    propuestaTexto: `${p.actual[ESENCIALES]}/${p.actual[INVERSION]}/${p.actual[RESERVA]}/${p.actual[RECOMPENSAS]} → ${p.propuesto[ESENCIALES]}/${p.propuesto[INVERSION]}/${p.propuesto[RESERVA]}/${p.propuesto[RECOMPENSAS]}`,
    accionPrimaria: 'Aplicar desde el próximo ciclo',
    accionSecundaria: 'Ver mis Esenciales',
  };
}
