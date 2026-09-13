/**
 * Dinero en centavos enteros (AD-04).
 *
 * Un Number de JS es exacto hasta 2^53, es decir 9.007.199.254.740.991 centavos.
 * Todo importe que entra al dominio pasa por aqui y sale como entero; ninguna
 * otra parte del codigo tiene permiso para hacer aritmetica con decimales.
 */

/** Simbolo por defecto. Los ajustes pueden cambiarlo por usuario. */
export let MONEDA = 'R$';

export function fijarMoneda(simbolo) {
  if (simbolo) MONEDA = simbolo;
}

/** Importe maximo aceptado: 10^12 centavos (diez mil millones de unidades). */
export const MAX_CENTAVOS = 1_000_000_000_000;

/**
 * Convierte una cadena tecleada por el usuario a centavos enteros.
 * Acepta "1234", "1.234,56", "1234.56", "1 234,56". Devuelve null si no es valida.
 *
 * La ambiguedad punto/coma se resuelve asi: el ultimo separador que aparezca
 * seguido de exactamente 1 o 2 digitos al final de la cadena es el decimal.
 * Cualquier otro punto, coma o espacio es separador de miles y se descarta.
 */
export function parsearCentavos(texto) {
  if (typeof texto === 'number') {
    return Number.isFinite(texto) ? Math.round(texto * 100) : null;
  }
  if (typeof texto !== 'string') return null;

  const limpio = texto.trim().replace(/[^\d.,\s-]/g, '');
  if (limpio === '' || limpio === '-') return null;

  const negativo = limpio.startsWith('-');
  const cuerpo = negativo ? limpio.slice(1) : limpio;

  // ¿Hay parte decimal? Un . o , seguido de 1-2 digitos y nada mas.
  const conDecimal = /^(.*)[.,](\d{1,2})$/.exec(cuerpo);

  let enteros;
  let decimales;
  if (conDecimal) {
    enteros = conDecimal[1];
    decimales = conDecimal[2].padEnd(2, '0');
  } else {
    enteros = cuerpo;
    decimales = '00';
  }

  enteros = enteros.replace(/[.,\s]/g, '');
  if (enteros === '') enteros = '0';
  if (!/^\d+$/.test(enteros)) return null;

  const centavos = Number(enteros) * 100 + Number(decimales);
  if (!Number.isSafeInteger(centavos)) return null;
  return negativo ? -centavos : centavos;
}

/**
 * Formatea centavos para mostrar. Estilo latinoamericano: punto para miles,
 * coma para decimales. Omite los decimales cuando son cero, que es el caso
 * mayoritario y ahorra ruido visual en el panel.
 */
export function formatear(centavos, { signo = false, decimales = 'auto', moneda = MONEDA } = {}) {
  if (!Number.isFinite(centavos)) return '—';
  const negativo = centavos < 0;
  const abs = Math.abs(Math.round(centavos));

  const enteros = Math.floor(abs / 100);
  const resto = abs % 100;
  const mostrarDecimales = decimales === 'siempre' || (decimales === 'auto' && resto !== 0);

  const milesSeparados = String(enteros).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const cuerpo = mostrarDecimales
    ? `${milesSeparados},${String(resto).padStart(2, '0')}`
    : milesSeparados;

  const prefijo = negativo ? '-' : signo ? '+' : '';
  return `${prefijo}${moneda}${cuerpo}`;
}

/** Suma segura de una lista de centavos. */
export function sumar(lista) {
  let total = 0;
  for (const n of lista) total += n;
  return total;
}

/**
 * Valida un importe de entrada del dominio.
 * Devuelve { ok: true, centavos } o { ok: false, codigo }.
 */
export function validarImporte(centavos, { maximo = MAX_CENTAVOS } = {}) {
  if (centavos === null || centavos === undefined) return { ok: false, codigo: 'IMPORTE_VACIO' };
  if (!Number.isInteger(centavos)) return { ok: false, codigo: 'IMPORTE_NO_ENTERO' };
  if (centavos <= 0) return { ok: false, codigo: 'IMPORTE_NO_POSITIVO' };
  if (centavos > maximo) return { ok: false, codigo: 'IMPORTE_EXCESIVO' };
  return { ok: true, centavos };
}

/** Porcentaje entero redondeado, protegido frente a divisor cero. */
export function porcentaje(parte, total) {
  if (!total) return 0;
  return Math.round((parte / total) * 100);
}

/** Razon en punto flotante, protegida frente a divisor cero. */
export function razon(parte, total) {
  if (!total) return 0;
  return parte / total;
}
