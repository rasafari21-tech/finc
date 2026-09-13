/**
 * Sobrante mensual e historial (§11 a §13).
 *
 * La propiedad que importa: el importe del sobrante de un mes es un hecho y no
 * cambia nunca, aunque despues se invierta.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calcularSobrante, crearSobrante, resolverSobrante, DESTINOS_SOBRANTE,
  esVisperaDeCierre, ordenarHistorial, mediaSobrante, TECHOS_LIBRES,
} from '../src/dominio/sobrante.js';
import { ESENCIALES, INVERSION, RESERVA, RECOMPENSAS, ceros } from '../src/dominio/buckets.js';

const u = (n) => n * 100;

function periodo({ techos = {}, totales = {}, id = '2026-09', ingresoTotal = 0 } = {}) {
  return { id, ingresoTotal, techos: { ...ceros(), ...techos }, totales: { ...ceros(), ...totales } };
}

test('solo cuentan Esenciales y Recompensas: los otros dos ya tienen destino', () => {
  assert.deepEqual(TECHOS_LIBRES, [ESENCIALES, RECOMPENSAS]);
});

test('el sobrante es lo que no se gastó de los dos techos libres', () => {
  const p = periodo({
    techos: { ESENCIALES: u(600), INVERSION: u(300), RESERVA: u(200), RECOMPENSAS: u(100) },
    totales: { ESENCIALES: u(560), INVERSION: u(120), RESERVA: 0, RECOMPENSAS: u(80) },
  });
  const { sobranteCents, desglose, hay } = calcularSobrante(p);

  assert.equal(desglose[ESENCIALES], u(40));
  assert.equal(desglose[RECOMPENSAS], u(20));
  assert.equal(sobranteCents, u(60), 'R$60, como el ejemplo de la especificación');
  assert.equal(hay, true);
});

test('un techo rebasado no resta del sobrante de los demás', () => {
  const p = periodo({
    techos: { ESENCIALES: u(600), RECOMPENSAS: u(100) },
    totales: { ESENCIALES: u(700), RECOMPENSAS: u(30) },
  });
  const { sobranteCents, desglose } = calcularSobrante(p);
  assert.equal(desglose[ESENCIALES], 0, 'rebasado cuenta como cero, nunca negativo');
  assert.equal(sobranteCents, u(70));
});

test('sin margen no hay sobrante', () => {
  const p = periodo({ techos: { ESENCIALES: u(100) }, totales: { ESENCIALES: u(100) } });
  assert.equal(calcularSobrante(p).hay, false);
});

test('el importe del sobrante NO cambia al decidir qué hacer con él', () => {
  const p = periodo({
    techos: { ESENCIALES: u(600), RECOMPENSAS: u(100) },
    totales: { ESENCIALES: u(560), RECOMPENSAS: u(80) },
  });
  const registro = crearSobrante(p, 1_700_000_000_000);
  assert.equal(registro.sobranteCents, u(60));
  assert.equal(registro.destino, null);
  assert.equal(registro.resueltoEn, null);

  const invertido = resolverSobrante(registro, 'INVERSION', 1_700_000_999_999);
  assert.equal(invertido.sobranteCents, u(60), 'septiembre sobraron R$60 aunque se invirtieran');
  assert.equal(invertido.destino, 'INVERSION');
  assert.equal(invertido.destinoCents, u(60));
  assert.ok(invertido.resueltoEn > registro.calculadoEn);
  assert.equal(registro.destino, null, 'el registro original no se muta');
});

test('dejarlo como está también se registra, pero no mueve dinero', () => {
  const p = periodo({ techos: { ESENCIALES: u(100) }, totales: { ESENCIALES: u(40) } });
  const r = resolverSobrante(crearSobrante(p), 'NADA');
  assert.equal(r.sobranteCents, u(60));
  assert.equal(r.destinoCents, 0);
  assert.equal(r.destino, 'NADA');
});

test('un destino inventado se rechaza', () => {
  const p = periodo({ techos: { ESENCIALES: u(100) }, totales: { ESENCIALES: u(40) } });
  assert.throws(() => resolverSobrante(crearSobrante(p), 'LOTERIA'), /DESTINO_DESCONOCIDO/);
});

test('los tres destinos posibles son los que espera la interfaz', () => {
  assert.deepEqual(DESTINOS_SOBRANTE.map((d) => d.id), ['INVERSION', 'RESERVA', 'NADA']);
});

test('la víspera de cierre cae el penúltimo o el último día del mes', () => {
  assert.equal(esVisperaDeCierre('2026-09-29', 30), true);
  assert.equal(esVisperaDeCierre('2026-09-30', 30), true);
  assert.equal(esVisperaDeCierre('2026-09-28', 30), false);
  assert.equal(esVisperaDeCierre('2026-02-27', 28), true);
  assert.equal(esVisperaDeCierre('2026-09-01', 30), false);
});

test('el historial va del mes más reciente al más antiguo', () => {
  const registros = [
    { periodId: '2026-07', sobranteCents: u(82) },
    { periodId: '2026-06', sobranteCents: u(45) },
    { periodId: '2026-09', sobranteCents: u(60) },
    { periodId: '2026-08', sobranteCents: u(37) },
  ];
  assert.deepEqual(ordenarHistorial(registros).map((r) => r.periodId), [
    '2026-09', '2026-08', '2026-07', '2026-06',
  ]);
  // El ejemplo de la especificación: 45, 82, 37, 60 → media 56
  assert.equal(mediaSobrante(registros), u(56));
});

test('sin historial la media es cero, no un error', () => {
  assert.equal(mediaSobrante([]), 0);
});
