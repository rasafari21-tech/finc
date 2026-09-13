/**
 * Puerto de reloj.
 *
 * El dominio nunca llama a Date.now() directamente: recibe el reloj inyectado.
 * Esa es la razon por la que un cierre de doce meses puede reproducirse en
 * segundos, tanto en los tests como en el panel del archivo de prueba.
 */

import { fechaLocal, periodoDe, horaLocal } from '../dominio/periodo.js';

export function relojReal(zona) {
  const z = zona ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  return {
    tipo: 'real',
    zona: z,
    ahora: () => Date.now(),
    fecha: () => fechaLocal(Date.now(), z),
    hora: () => horaLocal(Date.now(), z),
    periodo: () => periodoDe(Date.now(), z),
  };
}

/**
 * Reloj falso, manipulable. Lo usan los tests y el panel de pruebas.
 * `avanzar` acepta dias o meses; al saltar de mes cae en el dia 1 a las 09:00
 * locales, que es cuando de verdad se abre la app tras un cierre.
 */
export function relojFalso(inicio, zona = 'UTC') {
  let ts = typeof inicio === 'number' ? inicio : Date.parse(inicio);

  const reloj = {
    tipo: 'falso',
    zona,
    ahora: () => ts,
    fecha: () => fechaLocal(ts, zona),
    hora: () => horaLocal(ts, zona),
    periodo: () => periodoDe(ts, zona),

    fijar(valor) {
      ts = typeof valor === 'number' ? valor : Date.parse(valor);
      return reloj;
    },

    avanzarDias(n) {
      ts += n * 86_400_000;
      return reloj;
    },

    avanzarHoras(n) {
      ts += n * 3_600_000;
      return reloj;
    },

    /** Salta al dia 1 del mes siguiente, a las 09:00 de la zona indicada. */
    alDiaUnoSiguiente() {
      const f = fechaLocal(ts, zona);
      const [a, m] = f.split('-').map(Number);
      const siguienteA = m === 12 ? a + 1 : a;
      const siguienteM = m === 12 ? 1 : m + 1;
      ts = instanteLocal(siguienteA, siguienteM, 1, 9, zona);
      return reloj;
    },

    avanzarMeses(n) {
      for (let i = 0; i < n; i++) reloj.alDiaUnoSiguiente();
      return reloj;
    },
  };

  return reloj;
}

/**
 * Instante UTC que corresponde a una hora local dada en una zona.
 * Se resuelve por aproximacion y correccion: se parte de la hora como si fuera
 * UTC y se ajusta con el desfase real que el navegador reporta para ese punto.
 */
export function instanteLocal(anio, mes, dia, horaDelDia, zona) {
  const tentativo = Date.UTC(anio, mes - 1, dia, horaDelDia, 0, 0);
  const desfase = desfaseZona(tentativo, zona);
  return tentativo - desfase;
}

/** Desfase de la zona respecto de UTC, en milisegundos, para un instante dado. */
export function desfaseZona(ts, zona) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ts));

  const g = (t) => Number(partes.find((p) => p.type === t)?.value);
  const hora = g('hour') === 24 ? 0 : g('hour');
  const comoUTC = Date.UTC(g('year'), g('month') - 1, g('day'), hora, g('minute'), g('second'));
  return comoUTC - ts;
}
