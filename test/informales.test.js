/**
 * Reparto de ingresos informales y cantidades redondas (§7 a §10).
 *
 * Lo que se comprueba, sobre todo, es que NO aparezcan cifras como
 * R$3,27 + R$4,83 + R$2,91, que es el problema concreto que dio origen a esto.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { repartirRedondo, objetivosAPesos, UNIDAD } from '../src/dominio/redondeo.js';
import {
  MODO, PESOS_MITADES, UMBRAL_PREGUNTA, requierePreguntar,
  deficits, pesosInteligentes, distribuirInformal, opcionesDeReparto,
} from '../src/dominio/informales.js';
import { ESENCIALES, INVERSION, RESERVA, RECOMPENSAS, ORDEN, PESOS_POR_DEFECTO, ceros } from '../src/dominio/buckets.js';

const u = (n) => n * 100;
const suma = (p) => ORDEN.reduce((a, b) => a + p[b], 0);

function periodo({ techos = ceros(), totales = ceros(), pesos = PESOS_POR_DEFECTO } = {}) {
  return { id: '2026-09', pesos, techos: { ...ceros(), ...techos }, totales: { ...ceros(), ...totales } };
}

// --- redondeo -------------------------------------------------------------

test('redondeo · los ejemplos de la especificación salen exactos', () => {
  const casos = [
    [u(20), u(10), u(10)],
    [u(40), u(20), u(20)],
    [u(70), u(35), u(35)],
  ];
  for (const [importe, inv, res] of casos) {
    const { partes, fragmentado } = repartirRedondo(importe, PESOS_MITADES, { prioritario: RESERVA });
    assert.equal(fragmentado, true);
    assert.equal(partes[INVERSION], inv, `${importe} → Inversión`);
    assert.equal(partes[RESERVA], res, `${importe} → Reserva`);
    assert.equal(suma(partes), importe);
  }
});

test('redondeo · un importe impar da dos cantidades enteras, no dos con céntimos', () => {
  const { partes } = repartirRedondo(u(25), PESOS_MITADES, { prioritario: RESERVA });
  assert.equal(partes[INVERSION], u(13));
  assert.equal(partes[RESERVA], u(12));
  assert.equal(suma(partes), u(25));
});

test('redondeo · lo que no es cantidad entera NO se fragmenta', () => {
  const { partes, fragmentado, motivo } = repartirRedondo(327, PESOS_MITADES, { prioritario: RESERVA });
  assert.equal(fragmentado, false);
  assert.equal(motivo, 'NO_ES_CANTIDAD_ENTERA');
  assert.equal(partes[RESERVA], 327, 'va entero al prioritario');
  assert.equal(partes[INVERSION], 0);
});

test('redondeo · lo demasiado pequeño tampoco se fragmenta', () => {
  const { partes, fragmentado, motivo } = repartirRedondo(u(1), PESOS_MITADES, { prioritario: RESERVA });
  assert.equal(fragmentado, false);
  assert.equal(motivo, 'DEMASIADO_PEQUENO');
  assert.equal(partes[RESERVA], u(1));
});

test('redondeo · NUNCA produce céntimos sueltos al fragmentar', () => {
  for (let reales = 2; reales <= 3000; reales++) {
    const { partes, fragmentado } = repartirRedondo(u(reales), PESOS_POR_DEFECTO, { prioritario: RESERVA });
    assert.equal(suma(partes), u(reales));
    if (!fragmentado) continue;
    for (const b of ORDEN) {
      assert.equal(partes[b] % UNIDAD, 0, `${reales} deja céntimos en ${b}: ${partes[b]}`);
    }
  }
});

test('redondeo · la suma es exacta también con importes arbitrarios', () => {
  for (let i = 0; i < 5000; i++) {
    const importe = 1 + Math.floor(Math.random() * 2_000_000);
    const { partes } = repartirRedondo(importe, PESOS_POR_DEFECTO, { prioritario: RESERVA });
    assert.equal(suma(partes), importe);
  }
});

test('objetivosAPesos · normaliza a 10.000 puntos básicos exactos', () => {
  for (let i = 0; i < 2000; i++) {
    const objetivos = {
      ESENCIALES: Math.floor(Math.random() * 10000),
      INVERSION: Math.floor(Math.random() * 10000),
      RESERVA: Math.floor(Math.random() * 10000),
      RECOMPENSAS: Math.floor(Math.random() * 10000),
    };
    if (suma(objetivos) === 0) continue;
    const pesos = objetivosAPesos(objetivos);
    assert.equal(suma(pesos), 10_000);
  }
  assert.equal(objetivosAPesos(ceros()), null);
});

// --- umbral ---------------------------------------------------------------

test('umbral · R$20 y R$40 no preguntan; R$70 sí', () => {
  assert.equal(requierePreguntar(u(20)), false);
  assert.equal(requierePreguntar(u(40)), false);
  assert.equal(requierePreguntar(u(70)), true);
  assert.equal(UMBRAL_PREGUNTA, u(50));
});

// --- distribución por defecto ---------------------------------------------

test('por defecto · mitad Inversión, mitad Reserva, nada a las otras dos', () => {
  const p = periodo({ techos: { ESENCIALES: u(1000), INVERSION: u(500), RESERVA: u(300), RECOMPENSAS: u(200) } });
  const r = distribuirInformal(u(20), p, {});

  assert.equal(r.partes[INVERSION], u(10));
  assert.equal(r.partes[RESERVA], u(10));
  assert.equal(r.partes[ESENCIALES], 0);
  assert.equal(r.partes[RECOMPENSAS], 0);
});

test('MODO.MANUAL · va entero al techo elegido', () => {
  const p = periodo();
  const r = distribuirInformal(u(37), p, { modo: MODO.MANUAL, bucketManual: RECOMPENSAS });
  assert.equal(r.partes[RECOMPENSAS], u(37));
  assert.equal(suma(r.partes), u(37));
});

test('MODO.MANUAL · exige un techo válido', () => {
  assert.throws(() => distribuirInformal(u(10), periodo(), { modo: MODO.MANUAL }), /SIN_BUCKET_MANUAL/);
});

// --- lógica inteligente (§10) ---------------------------------------------

test('déficits · mide solo lo que está en rojo', () => {
  const p = periodo({
    techos: { ESENCIALES: u(600), RECOMPENSAS: u(100) },
    totales: { ESENCIALES: u(650), RECOMPENSAS: u(40) },
  });
  const d = deficits(p);
  assert.equal(d[ESENCIALES], u(50));
  assert.equal(d[RECOMPENSAS], 0);
});

test('inteligente · sin techos en rojo respeta la distribución elegida', () => {
  const p = periodo({ techos: { ESENCIALES: u(600) }, totales: { ESENCIALES: u(100) } });
  const r = pesosInteligentes(u(20), p, PESOS_MITADES);
  assert.equal(r.motivo, 'SIN_DEFICIT');
  assert.deepEqual(r.pesos, PESOS_MITADES);
});

test('inteligente · si no llega a tapar el agujero, todo va al agujero', () => {
  const p = periodo({
    techos: { ESENCIALES: u(600) },
    totales: { ESENCIALES: u(650) },
  });
  const r = distribuirInformal(u(20), p, {});

  assert.equal(r.ajuste, 'TAPA_DEFICIT');
  assert.equal(r.partes[ESENCIALES], u(20), 'los R$20 tapan sobrepaso, no se van a Reserva');
  assert.equal(r.partes[RESERVA], 0);
});

test('inteligente · tapa el agujero y reparte lo que sobra', () => {
  const p = periodo({
    techos: { ESENCIALES: u(600) },
    totales: { ESENCIALES: u(620) },
  });
  // R$100: R$20 tapan Esenciales, R$80 se reparten mitad y mitad
  const r = distribuirInformal(u(100), p, { modo: MODO.MITADES });

  assert.equal(r.ajuste, 'TAPA_Y_REPARTE');
  assert.equal(r.partes[ESENCIALES], u(20));
  assert.equal(r.partes[INVERSION], u(40));
  assert.equal(r.partes[RESERVA], u(40));
  assert.equal(suma(r.partes), u(100));
});

test('inteligente · reparte el agujero entre varios techos en rojo', () => {
  const p = periodo({
    techos: { ESENCIALES: u(600), RECOMPENSAS: u(100) },
    totales: { ESENCIALES: u(630), RECOMPENSAS: u(110) },
  });
  const r = distribuirInformal(u(40), p, {});

  assert.equal(r.ajuste, 'TAPA_DEFICIT');
  assert.equal(r.partes[ESENCIALES] + r.partes[RECOMPENSAS], u(40));
  assert.ok(r.partes[ESENCIALES] > r.partes[RECOMPENSAS], 'el agujero mayor recibe más');
  assert.equal(suma(r.partes), u(40));
});

test('inteligente · se puede desactivar para ver el reparto puro', () => {
  const p = periodo({ techos: { ESENCIALES: u(600) }, totales: { ESENCIALES: u(650) } });
  const r = distribuirInformal(u(20), p, { inteligente: false });
  assert.equal(r.partes[INVERSION], u(10));
  assert.equal(r.partes[RESERVA], u(10));
});

// --- las tres opciones de §9 ----------------------------------------------

test('opciones · las tres llegan con sus cifras ya calculadas', () => {
  const p = periodo({ techos: { ESENCIALES: u(1000) }, totales: { ESENCIALES: u(400) } });
  const ops = opcionesDeReparto(u(70), p, PESOS_POR_DEFECTO);

  assert.equal(ops.length, 3);

  const mitades = ops.find((o) => o.id === MODO.MITADES);
  assert.equal(mitades.reparto.partes[INVERSION], u(35));
  assert.equal(mitades.reparto.partes[RESERVA], u(35));

  const cuatro = ops.find((o) => o.id === MODO.CUATRO);
  assert.equal(suma(cuatro.reparto.partes), u(70));
  assert.ok(cuatro.reparto.partes[ESENCIALES] > 0, 'el reparto a cuatro sí toca Esenciales');

  const manual = ops.find((o) => o.id === MODO.MANUAL);
  assert.equal(manual.reparto, null, 'el manual no calcula nada hasta que se elige techo');
});

test('opciones · el reparto a cuatro nunca deja céntimos', () => {
  const p = periodo();
  for (const reales of [70, 100, 137, 250, 999]) {
    const ops = opcionesDeReparto(u(reales), p, PESOS_POR_DEFECTO);
    const cuatro = ops.find((o) => o.id === MODO.CUATRO).reparto;
    assert.equal(suma(cuatro.partes), u(reales));
    if (!cuatro.fragmentado) continue;
    for (const b of ORDEN) assert.equal(cuatro.partes[b] % UNIDAD, 0);
  }
});

test('ningún ingreso se queda sin asignar, sea cual sea el importe', () => {
  const p = periodo({ techos: { ESENCIALES: u(600) }, totales: { ESENCIALES: u(700) } });
  for (let i = 0; i < 3000; i++) {
    const importe = 1 + Math.floor(Math.random() * 500_000);
    for (const modo of [MODO.MITADES, MODO.CUATRO]) {
      const r = distribuirInformal(importe, p, { modo, pesosBase: PESOS_POR_DEFECTO });
      assert.equal(suma(r.partes), importe, `${modo} con ${importe}`);
    }
  }
});
