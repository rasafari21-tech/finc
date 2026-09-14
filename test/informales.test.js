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
  SELECCION_POR_DEFECTO, pesosDeSeleccion, limpiarSeleccion,
  deficits, distribuirInformal, previoDeSeleccion,
} from '../src/dominio/informales.js';
import { ESENCIALES, INVERSION, RESERVA, RECOMPENSAS, ORDEN, PESOS_POR_DEFECTO, ceros } from '../src/dominio/buckets.js';

const u = (n) => n * 100;
const suma = (p) => ORDEN.reduce((a, b) => a + p[b], 0);

// Mitad y mitad: ya no es una constante del modulo —la seleccion se calcula—,
// pero sigue siendo el caso mas util para probar el redondeo en si.
const MITADES = { ESENCIALES: 0, INVERSION: 5_000, RESERVA: 5_000, RECOMPENSAS: 0 };

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
    const { partes, fragmentado } = repartirRedondo(importe, MITADES, { prioritario: RESERVA });
    assert.equal(fragmentado, true);
    assert.equal(partes[INVERSION], inv, `${importe} → Inversión`);
    assert.equal(partes[RESERVA], res, `${importe} → Reserva`);
    assert.equal(suma(partes), importe);
  }
});

test('redondeo · un importe impar da dos cantidades enteras, no dos con céntimos', () => {
  const { partes } = repartirRedondo(u(25), MITADES, { prioritario: RESERVA });
  assert.equal(partes[INVERSION], u(13));
  assert.equal(partes[RESERVA], u(12));
  assert.equal(suma(partes), u(25));
});

test('redondeo · lo que no es cantidad entera NO se fragmenta', () => {
  const { partes, fragmentado, motivo } = repartirRedondo(327, MITADES, { prioritario: RESERVA });
  assert.equal(fragmentado, false);
  assert.equal(motivo, 'NO_ES_CANTIDAD_ENTERA');
  assert.equal(partes[RESERVA], 327, 'va entero al prioritario');
  assert.equal(partes[INVERSION], 0);
});

test('redondeo · lo demasiado pequeño tampoco se fragmenta', () => {
  const { partes, fragmentado, motivo } = repartirRedondo(u(1), MITADES, { prioritario: RESERVA });
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

// --- seleccion ------------------------------------------------------------

test('por defecto vienen marcados Inversión y Reserva', () => {
  assert.deepEqual(SELECCION_POR_DEFECTO, [INVERSION, RESERVA]);
  assert.deepEqual(limpiarSeleccion(undefined), [INVERSION, RESERVA]);
  assert.deepEqual(limpiarSeleccion([]), [INVERSION, RESERVA], 'sin nada marcado se vuelve al defecto');
});

test('la selección se ordena y se limpia de repetidos', () => {
  assert.deepEqual(limpiarSeleccion([RECOMPENSAS, ESENCIALES, ESENCIALES]), [ESENCIALES, RECOMPENSAS]);
  assert.deepEqual(limpiarSeleccion(['INVENTADO', RESERVA]), [RESERVA]);
});

test('los pesos se reparten en partes iguales y suman 10.000 exactos', () => {
  assert.equal(pesosDeSeleccion([INVERSION, RESERVA])[INVERSION], 5_000);
  assert.equal(pesosDeSeleccion([ESENCIALES])[ESENCIALES], 10_000);

  for (const sel of [[ESENCIALES], [INVERSION, RESERVA], [ESENCIALES, INVERSION, RESERVA], ORDEN]) {
    const p = pesosDeSeleccion(sel);
    assert.equal(suma(p), 10_000, `${sel.length} techos no suman 10.000`);
    for (const b of ORDEN) {
      if (!sel.includes(b)) assert.equal(p[b], 0, `${b} no estaba marcado y recibió peso`);
    }
  }
});

test('tres techos: el resto de los puntos básicos va por orden canónico', () => {
  const p = pesosDeSeleccion([ESENCIALES, INVERSION, RESERVA]);
  assert.equal(suma(p), 10_000);
  assert.equal(p[ESENCIALES], 3_334, 'el primero del orden absorbe el punto suelto');
  assert.equal(p[INVERSION], 3_333);
  assert.equal(p[RESERVA], 3_333);
});

test('sin ningún techo marcado es un error del programador, no del usuario', () => {
  assert.throws(() => pesosDeSeleccion([]), /SIN_SELECCION/);
});

// --- reparto entre los techos marcados ------------------------------------

test('por defecto · mitad Inversión, mitad Reserva', () => {
  const p = periodo({ techos: { ESENCIALES: u(1000), INVERSION: u(500), RESERVA: u(300), RECOMPENSAS: u(200) } });
  const r = distribuirInformal(u(20), p, {});

  assert.equal(r.partes[INVERSION], u(10));
  assert.equal(r.partes[RESERVA], u(10));
  assert.equal(r.partes[ESENCIALES], 0);
  assert.equal(r.partes[RECOMPENSAS], 0);
});

test('un solo techo marcado se lo lleva entero', () => {
  const r = distribuirInformal(u(37), periodo(), { buckets: [RECOMPENSAS] });
  assert.equal(r.partes[RECOMPENSAS], u(37));
  assert.equal(suma(r.partes), u(37));
});

test('los cuatro marcados dan cuartos, no el reparto 50/25/15/10', () => {
  const r = distribuirInformal(u(100), periodo(), { buckets: ORDEN });
  for (const b of ORDEN) assert.equal(r.partes[b], u(25), `${b} deberia llevarse un cuarto`);
});

test('tres marcados dan tercios en cantidades enteras', () => {
  const r = distribuirInformal(u(30), periodo(), { buckets: [ESENCIALES, INVERSION, RESERVA] });
  assert.equal(r.partes[ESENCIALES], u(10));
  assert.equal(r.partes[INVERSION], u(10));
  assert.equal(r.partes[RESERVA], u(10));
  assert.equal(r.partes[RECOMPENSAS], 0);
  assert.equal(suma(r.partes), u(30));
});

test('lo que no se puede partir en redondo va entero a Reserva si está marcada', () => {
  const r = distribuirInformal(327, periodo(), { buckets: [INVERSION, RESERVA] });
  assert.equal(r.fragmentado, false);
  assert.equal(r.partes[RESERVA], 327);
  assert.equal(r.partes[INVERSION], 0);
});

test('sin Reserva marcada, lo no fragmentable va al primero del orden', () => {
  const r = distribuirInformal(327, periodo(), { buckets: [ESENCIALES, RECOMPENSAS] });
  assert.equal(r.partes[ESENCIALES], 327);
});

test('la vista previa coincide con lo que se acabará guardando', () => {
  const p = periodo();
  for (const sel of [[INVERSION, RESERVA], ORDEN, [ESENCIALES]]) {
    const previo = previoDeSeleccion(u(60), p, sel);
    const real = distribuirInformal(u(60), p, { buckets: sel }).partes;
    assert.deepEqual(previo, real);
  }
  assert.equal(previoDeSeleccion(0, p, [RESERVA]), null, 'sin importe no hay nada que enseñar');
});

test('déficits · mide solo lo que está en rojo', () => {
  const p = periodo({
    techos: { ESENCIALES: u(600), RECOMPENSAS: u(100) },
    totales: { ESENCIALES: u(650), RECOMPENSAS: u(40) },
  });
  const d = deficits(p);
  assert.equal(d[ESENCIALES], u(50));
  assert.equal(d[RECOMPENSAS], 0);
});

test('la selección manda: un techo en rojo no desvía el dinero', () => {
  const p = periodo({ techos: { ESENCIALES: u(600) }, totales: { ESENCIALES: u(700) } });
  const r = distribuirInformal(u(20), p, { buckets: [INVERSION, RESERVA] });
  assert.equal(r.partes[ESENCIALES], 0, 'si no lo marcaste, no va ahi');
  assert.equal(r.partes[INVERSION], u(10));
  assert.equal(r.partes[RESERVA], u(10));
});

test('ningún ingreso se queda sin asignar, marque lo que marque', () => {
  const p = periodo({ techos: { ESENCIALES: u(600) }, totales: { ESENCIALES: u(700) } });
  const combinaciones = [
    [INVERSION, RESERVA], ORDEN, [ESENCIALES], [RECOMPENSAS],
    [ESENCIALES, RESERVA], [ESENCIALES, INVERSION, RECOMPENSAS],
  ];
  for (let i = 0; i < 2000; i++) {
    const importe = 1 + Math.floor(Math.random() * 500_000);
    const sel = combinaciones[i % combinaciones.length];
    const r = distribuirInformal(importe, p, { buckets: sel });
    assert.equal(suma(r.partes), importe, `${sel.join('+')} con ${importe}`);
    for (const b of ORDEN) {
      if (!sel.includes(b)) assert.equal(r.partes[b], 0, `${b} recibio sin estar marcado`);
    }
  }
});
