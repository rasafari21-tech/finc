/**
 * Los cuatro techos y su orden canonico.
 *
 * El ORDEN no es cosmetico: es el desempate del reparto por resto mayor
 * (reparto.js) y lo que garantiza que el mismo importe produzca siempre el
 * mismo reparto. Cambiarlo invalida el recalculo determinista de §5.
 */

export const ESENCIALES = 'ESENCIALES';
export const INVERSION = 'INVERSION';
export const RESERVA = 'RESERVA';
export const RECOMPENSAS = 'RECOMPENSAS';

/** Orden canonico. No reordenar. */
export const ORDEN = [ESENCIALES, INVERSION, RESERVA, RECOMPENSAS];

/** Bucket especial del anclaje (§10): no consume techo, solo documenta deriva. */
export const SIN_REGISTRAR = 'SIN_REGISTRAR';

/** Pesos por defecto en puntos basicos. Deben sumar 10.000. */
export const PESOS_POR_DEFECTO = {
  [ESENCIALES]: 5000,
  [INVERSION]: 2500,
  [RESERVA]: 1500,
  [RECOMPENSAS]: 1000,
};

export const ETIQUETAS = {
  [ESENCIALES]: 'Esenciales',
  [INVERSION]: 'Inversión',
  [RESERVA]: 'Reserva',
  [RECOMPENSAS]: 'Recompensas',
  [SIN_REGISTRAR]: 'Sin registrar',
};

/**
 * Destino del excedente cuando un techo absoluto se desborda (§6.4).
 * La cadena debe ser aciclica y terminar siempre en el Fondo de Ahorro.
 */
export const CASCADA_POR_DEFECTO = {
  [ESENCIALES]: RESERVA,
  [INVERSION]: null, // sin tope por defecto
  [RESERVA]: 'FONDO_AHORRO',
  [RECOMPENSAS]: RESERVA,
};

/** Fondos independientes del ciclo mensual. */
export const FONDO_AHORRO = 'FONDO_AHORRO';
export const CARTERA_INVERSION = 'CARTERA_INVERSION';

export function esBucket(valor) {
  return ORDEN.includes(valor);
}

/** Convierte un mapa de pesos a un array alineado con ORDEN. */
export function pesosAArray(pesos) {
  return ORDEN.map((b) => pesos[b] ?? 0);
}

/** Convierte un array alineado con ORDEN a un mapa por bucket. */
export function arrayAPesos(arr) {
  const salida = {};
  ORDEN.forEach((b, i) => {
    salida[b] = arr[i];
  });
  return salida;
}

/** Mapa con los cuatro techos a cero. */
export function ceros() {
  const salida = {};
  for (const b of ORDEN) salida[b] = 0;
  return salida;
}

/**
 * Valida un juego de pesos: cuatro enteros en puntos basicos que sumen 10.000.
 * Devuelve { ok } o { ok: false, codigo }.
 */
export function validarPesos(pesos) {
  let total = 0;
  for (const b of ORDEN) {
    const p = pesos[b];
    if (!Number.isInteger(p) || p < 0 || p > 10_000) {
      return { ok: false, codigo: 'PESO_INVALIDO', bucket: b };
    }
    total += p;
  }
  if (total !== 10_000) return { ok: false, codigo: 'PESOS_NO_SUMAN_100', total };
  return { ok: true };
}

/**
 * Verifica que una cadena de cascada no tenga ciclos (§6.4).
 * Se valida al guardar la configuracion, no en cada reparto.
 */
export function validarCascada(cascada) {
  for (const inicio of ORDEN) {
    const vistos = new Set([inicio]);
    let actual = cascada[inicio];
    while (actual && actual !== FONDO_AHORRO) {
      if (vistos.has(actual)) return { ok: false, codigo: 'CASCADA_CICLICA', bucket: inicio };
      vistos.add(actual);
      actual = cascada[actual];
    }
  }
  return { ok: true };
}
