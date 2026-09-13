/**
 * Reparto por resto mayor y cascada de techos absolutos (§6.2 y §6.4).
 *
 * Invariante que sostiene todo el motor: la suma de las cuatro partes es
 * SIEMPRE exactamente el importe original. Ni un centavo se pierde ni se
 * inventa. Los tests lo verifican sobre miles de importes aleatorios.
 */

import { ORDEN, FONDO_AHORRO, ceros, validarPesos } from './buckets.js';
import { sumar } from './dinero.js';

/**
 * Reparte un importe entre los cuatro techos segun sus pesos en puntos basicos.
 *
 * Metodo del resto mayor: se toma el piso de cada parte exacta y los centavos
 * sobrantes (0 a 3) se reparten uno a uno, empezando por la mayor parte
 * fraccionaria. El empate se rompe por ORDEN, lo que hace el resultado
 * reproducible: mismo importe y mismos pesos dan siempre el mismo reparto.
 *
 * @param {number} importeCents entero positivo
 * @param {Object} pesos mapa bucket -> puntos basicos, debe sumar 10.000
 * @returns {Object} mapa bucket -> centavos
 */
export function repartir(importeCents, pesos) {
  if (!Number.isInteger(importeCents) || importeCents <= 0) {
    throw new Error('REPARTO_IMPORTE_INVALIDO');
  }
  const v = validarPesos(pesos);
  if (!v.ok) throw new Error(`REPARTO_${v.codigo}`);

  const exacto = ORDEN.map((b) => (importeCents * pesos[b]) / 10_000);
  const base = exacto.map(Math.floor);
  let resto = importeCents - sumar(base);

  // Cola de desempate: parte fraccionaria descendente, luego ORDEN.
  const cola = exacto
    .map((valor, i) => ({ i, frac: valor - Math.floor(valor) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  for (let k = 0; resto > 0; k++, resto--) {
    base[cola[k % cola.length].i] += 1;
  }

  const salida = {};
  ORDEN.forEach((b, i) => {
    salida[b] = base[i];
  });
  return salida;
}

/**
 * Aplica un reparto contra los techos actuales respetando los topes absolutos.
 *
 * Sin topes absolutos esto es la identidad: el techo derivado es la propia suma
 * de lo asignado, asi que un ingreso no puede desbordarlo, lo agranda. Con tope
 * absoluto el excedente cae por la cadena de cascada hasta el Fondo de Ahorro,
 * que es el unico destino terminal. Nada se evapora.
 *
 * @param {Object} reparto mapa bucket -> centavos a asignar
 * @param {Object} techosActuales mapa bucket -> centavos ya asignados este periodo
 * @param {Object} topes mapa bucket -> centavos o null
 * @param {Object} cascada mapa bucket -> bucket destino o FONDO_AHORRO
 * @returns {{asignado: Object, aFondo: number, lineas: Array}}
 */
export function aplicarCascada(reparto, techosActuales, topes = {}, cascada = {}) {
  const asignado = ceros();
  const lineas = [];
  let aFondo = 0;

  // Cola de trabajo: cada entrada es un intento de meter N centavos en un bucket.
  const pendientes = ORDEN.filter((b) => reparto[b] > 0).map((b) => ({
    bucket: b,
    centavos: reparto[b],
    motivo: 'reparto',
  }));

  let guarda = 0;
  while (pendientes.length > 0) {
    if (++guarda > 64) throw new Error('CASCADA_SIN_TERMINAR');
    const { bucket, centavos, motivo } = pendientes.shift();

    const tope = topes[bucket];
    if (tope === null || tope === undefined) {
      asignado[bucket] += centavos;
      lineas.push({ bucket, centavos, motivo });
      continue;
    }

    const yaOcupado = (techosActuales[bucket] ?? 0) + asignado[bucket];
    const hueco = Math.max(0, tope - yaOcupado);
    const cabe = Math.min(hueco, centavos);
    const excedente = centavos - cabe;

    if (cabe > 0) {
      asignado[bucket] += cabe;
      lineas.push({ bucket, centavos: cabe, motivo });
    }
    if (excedente > 0) {
      const destino = cascada[bucket];
      if (!destino || destino === FONDO_AHORRO) {
        aFondo += excedente;
        lineas.push({ bucket: FONDO_AHORRO, centavos: excedente, motivo: 'cascada', desde: bucket });
      } else {
        pendientes.push({ bucket: destino, centavos: excedente, motivo: 'cascada', desde: bucket });
      }
    }
  }

  return { asignado, aFondo, lineas };
}

/**
 * Reparto completo de un ingreso: divide y aplica cascada en un solo paso.
 * Es lo que invoca el comando de registrar ingreso.
 */
export function repartirIngreso(importeCents, { pesos, techosActuales, topes, cascada }) {
  const bruto = repartir(importeCents, pesos);
  const { asignado, aFondo, lineas } = aplicarCascada(bruto, techosActuales, topes, cascada);

  // Comprobacion de integridad: nada se pierde por el camino.
  const total = sumar(ORDEN.map((b) => asignado[b])) + aFondo;
  if (total !== importeCents) {
    throw new Error(`CASCADA_DESCUADRADA: ${total} != ${importeCents}`);
  }

  return { bruto, asignado, aFondo, lineas };
}
