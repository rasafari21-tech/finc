import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluarMovimiento, aplicarVeredicto, sugerirDestino, medianaDe } from '../src/dominio/clasificador.js';
import { REGLAS_NUCLEO, componerReglas } from '../src/dominio/reglas.js';
import { ESENCIALES, INVERSION, RESERVA, RECOMPENSAS } from '../src/dominio/buckets.js';

const PERIODO = {
  id: '2026-09',
  techos: { ESENCIALES: 620_000_00, INVERSION: 310_000_00, RESERVA: 186_000_00, RECOMPENSAS: 124_000_00 },
  totales: { ESENCIALES: 0, INVERSION: 0, RESERVA: 0, RECOMPENSAS: 0 },
};

const CTX = {
  periodo: PERIODO,
  fechaHoy: '2026-09-15',
  medianaImporte: 50_000_00,
  periodosCerrados: ['2026-08', '2026-07'],
  movimientosRecientes: [],
};

function mov(extra = {}) {
  return {
    id: 'm1',
    tipo: 'gasto',
    bucket: ESENCIALES,
    categoryId: 'mercado',
    importeCents: 45_000_00,
    localDate: '2026-09-15',
    periodId: '2026-09',
    ts: Date.parse('2026-09-15T12:00:00Z'),
    tags: [],
    nota: '',
    ...extra,
  };
}

test('el catalogo tiene exactamente las 18 reglas nucleo', () => {
  assert.equal(REGLAS_NUCLEO.length, 18);
  const ids = REGLAS_NUCLEO.map((r) => r.id);
  assert.equal(new Set(ids).size, 18, 'sin identificadores repetidos');
  for (let i = 1; i <= 18; i++) {
    assert.ok(ids.includes(`R-${String(i).padStart(2, '0')}`), `falta R-${i}`);
  }
});

test('toda regla lleva mensaje y razonamiento para el usuario', () => {
  for (const r of REGLAS_NUCLEO) {
    assert.ok(r.mensaje?.length > 5, `${r.id} sin mensaje`);
    assert.ok(r.porque?.length > 20, `${r.id} sin razonamiento`);
    assert.ok(r.cuando, `${r.id} sin condicion`);
    if (r.accion === 'FORCE') assert.ok(r.bucketDestino, `${r.id} FORCE sin destino`);
  }
});

test('las reglas se ordenan por prioridad ascendente', () => {
  const orden = componerReglas().map((r) => r.prioridad);
  for (let i = 1; i < orden.length; i++) assert.ok(orden[i] >= orden[i - 1]);
});

test('las reglas de usuario nunca adelantan al nucleo', () => {
  const compuestas = componerReglas([{ id: 'U-1', prioridad: 1, cuando: { op: 'siempre' }, accion: 'WARN' }]);
  const primera = compuestas[0];
  assert.equal(primera.nucleo, true, 'una regla de usuario con prioridad 1 sigue detras del nucleo');
  assert.equal(compuestas.find((r) => r.id === 'U-1').prioridad, 100);
});

// --- reglas concretas -----------------------------------------------------

test('R-01 · un regalo no entra en Esenciales', () => {
  const v = evaluarMovimiento(mov({ categoryId: 'regalo', bucket: ESENCIALES }), CTX);
  assert.equal(v.tipo, 'FORCE');
  assert.equal(v.ruleId, 'R-01');
  assert.equal(v.bucketDestino, RECOMPENSAS);
  assert.equal(v.anulable, false, 'no se puede saltar');
});

test('R-01 · un regalo en Recompensas pasa sin ruido', () => {
  const v = evaluarMovimiento(mov({ categoryId: 'regalo', bucket: RECOMPENSAS, importeCents: 1000 }), CTX);
  assert.equal(v.tipo, 'OK');
});

test('R-02 · apostar no es invertir', () => {
  const v = evaluarMovimiento(mov({ categoryId: 'apuesta', bucket: INVERSION }), CTX);
  assert.equal(v.ruleId, 'R-02');
  assert.equal(v.bucketDestino, RECOMPENSAS);
});

test('R-02 · cripto especulativo tampoco', () => {
  const v = evaluarMovimiento(mov({ categoryId: 'cripto', bucket: INVERSION }), CTX);
  assert.equal(v.ruleId, 'R-02');
});

test('R-03 · restaurante fuera de Esenciales', () => {
  const v = evaluarMovimiento(mov({ categoryId: 'restaurante', bucket: ESENCIALES }), CTX);
  assert.equal(v.ruleId, 'R-03');
  assert.equal(v.bucketDestino, RECOMPENSAS);
});

test('R-04 · comida esencial en comercio que no es supermercado exige prueba', () => {
  const v = evaluarMovimiento(mov({ categoryId: 'mercado', bucket: ESENCIALES, comercioTipo: 'tienda' }), CTX);
  assert.equal(v.tipo, 'REQUIRE_EVIDENCE');
  assert.equal(v.ruleId, 'R-04');
  assert.ok(v.requisitos.length >= 2);
});

test('R-04 · con etiqueta de viaje laboral y nota suficiente, pasa', () => {
  const v = evaluarMovimiento(
    mov({
      categoryId: 'mercado',
      bucket: ESENCIALES,
      comercioTipo: 'tienda',
      tags: ['viaje-laboral'],
      nota: 'Almuerzo en ruta a la clínica de Mérida',
    }),
    CTX,
  );
  assert.equal(v.tipo, 'OK');
});

test('R-04 · con etiqueta pero sin nota suficiente, sigue pidiendo prueba', () => {
  const v = evaluarMovimiento(
    mov({ categoryId: 'mercado', bucket: ESENCIALES, comercioTipo: 'tienda', tags: ['viaje-laboral'], nota: 'ok' }),
    CTX,
  );
  assert.equal(v.tipo, 'REQUIRE_EVIDENCE');
});

test('R-04 · en supermercado no se pregunta nada', () => {
  const v = evaluarMovimiento(mov({ categoryId: 'mercado', bucket: ESENCIALES, comercioTipo: 'supermercado' }), CTX);
  assert.equal(v.tipo, 'OK');
});

test('R-05 · las suscripciones de entretenimiento van a Recompensas', () => {
  const v = evaluarMovimiento(mov({ categoryId: 'suscripcion', bucket: ESENCIALES, importeCents: 1500_00 }), CTX);
  assert.equal(v.ruleId, 'R-05');
});

test('R-06 · un gadget en Inversion exige justificacion', () => {
  const v = evaluarMovimiento(mov({ categoryId: 'gadget', bucket: INVERSION, importeCents: 20_000_00 }), CTX);
  assert.equal(v.tipo, 'REQUIRE_EVIDENCE');
  assert.equal(v.ruleId, 'R-06');
});

test('R-06 · con uso profesional, importe bajo y nota larga, entra en Inversion', () => {
  const v = evaluarMovimiento(
    mov({
      categoryId: 'gadget',
      bucket: INVERSION,
      importeCents: 20_000_00,
      usoProfesional: true,
      nota: 'Monitor para la consulta de teleterapia',
    }),
    CTX,
  );
  assert.equal(v.tipo, 'OK');
});

test('R-06 · si pasa del 15 % del techo de Inversion, no cuela aunque sea profesional', () => {
  const v = evaluarMovimiento(
    mov({
      categoryId: 'gadget',
      bucket: INVERSION,
      importeCents: 100_000_00, // > 15 % de 310.000
      usoProfesional: true,
      nota: 'Equipo profesional carísimo para la consulta',
    }),
    CTX,
  );
  assert.equal(v.tipo, 'REQUIRE_EVIDENCE');
});

test('R-07 · la ropa va a Recompensas', () => {
  const v = evaluarMovimiento(mov({ categoryId: 'ropa', bucket: ESENCIALES, importeCents: 30_000_00 }), CTX);
  assert.equal(v.ruleId, 'R-07');
  assert.equal(v.bucketDestino, RECOMPENSAS);
});

test('R-07 · salvo que sea uniforme o calzado de seguridad', () => {
  const v = evaluarMovimiento(
    mov({ categoryId: 'ropa', bucket: ESENCIALES, importeCents: 30_000_00, tags: ['calzado-seguridad'] }),
    CTX,
  );
  assert.equal(v.tipo, 'OK');
});

test('R-08 · no se gasta de Reserva sin declarar el motivo', () => {
  const v = evaluarMovimiento(mov({ bucket: RESERVA, categoryId: 'reparacion' }), CTX);
  assert.equal(v.tipo, 'DENY');
  assert.equal(v.ruleId, 'R-08');
});

test('R-08 · con codigo de motivo, la retirada se permite', () => {
  const v = evaluarMovimiento(mov({ bucket: RESERVA, categoryId: 'reparacion', razonReserva: 'REPARACION' }), CTX);
  assert.equal(v.tipo, 'OK');
});

test('R-09 · la estetica no es esencial sin prescripcion', () => {
  const v = evaluarMovimiento(mov({ categoryId: 'belleza', bucket: ESENCIALES, importeCents: 8000_00 }), CTX);
  assert.equal(v.ruleId, 'R-09');
});

test('R-10 · formacion sin certificar ni relacion con el ingreso no es Inversion', () => {
  const v = evaluarMovimiento(mov({ categoryId: 'formacion', bucket: INVERSION, importeCents: 30_000_00 }), CTX);
  assert.equal(v.ruleId, 'R-10');
  assert.equal(v.bucketDestino, RECOMPENSAS);
});

test('R-10 · certificable y relacionada con el ingreso, entra', () => {
  const v = evaluarMovimiento(
    mov({
      categoryId: 'formacion',
      bucket: INVERSION,
      importeCents: 30_000_00,
      certificable: true,
      relacionadaConIngreso: true,
    }),
    CTX,
  );
  assert.equal(v.tipo, 'OK');
});

test('R-11 · el pago minimo de deuda es Esencial, lo pongas donde lo pongas', () => {
  const v = evaluarMovimiento(mov({ categoryId: 'deuda-minimo', bucket: INVERSION, importeCents: 40_000_00 }), CTX);
  assert.equal(v.ruleId, 'R-11');
  assert.equal(v.bucketDestino, ESENCIALES);
});

test('R-12 · los accesorios de mascota no son esenciales', () => {
  const v = evaluarMovimiento(mov({ categoryId: 'mascota-extra', bucket: ESENCIALES, importeCents: 5000_00 }), CTX);
  assert.equal(v.ruleId, 'R-12');
});

test('R-12 · el veterinario si lo es', () => {
  const v = evaluarMovimiento(mov({ categoryId: 'mascota-salud', bucket: ESENCIALES, importeCents: 5000_00 }), CTX);
  assert.equal(v.tipo, 'OK');
});

test('R-13 · un viaje no es transporte esencial', () => {
  const v = evaluarMovimiento(mov({ categoryId: 'viaje', bucket: ESENCIALES, importeCents: 80_000_00 }), CTX);
  assert.equal(v.ruleId, 'R-13');
});

test('R-14 · mas de un cuarto del techo avisa, pero no bloquea', () => {
  const v = evaluarMovimiento(mov({ bucket: ESENCIALES, importeCents: 200_000_00 }), CTX);
  assert.equal(v.tipo, 'WARN');
  assert.equal(v.ruleId, 'R-14');
  assert.equal(v.anulable, true);
});

test('R-14 · con justificacion suficiente, la escritura procede', () => {
  const m = mov({ bucket: ESENCIALES, importeCents: 200_000_00 });
  const v = evaluarMovimiento(m, CTX);
  const sinNota = aplicarVeredicto(m, v, {});
  assert.equal(sinNota.permitido, false);
  assert.equal(sinNota.requiere, 'justificacion');

  const conNota = aplicarVeredicto(m, v, { justificacion: 'Pago anual del seguro del piso' });
  assert.equal(conNota.permitido, true);
});

test('R-15 · el tercer capricho en 24 h avisa del patron', () => {
  const base = Date.parse('2026-09-15T12:00:00Z');
  const recientes = [
    { bucket: RECOMPENSAS, tipo: 'gasto', ts: base - 3_600_000 },
    { bucket: RECOMPENSAS, tipo: 'gasto', ts: base - 7_200_000 },
  ];
  const v = evaluarMovimiento(
    mov({ bucket: RECOMPENSAS, categoryId: 'ocio', importeCents: 3000_00, ts: base }),
    { ...CTX, movimientosRecientes: recientes },
  );
  assert.equal(v.ruleId, 'R-15');
  assert.equal(v.tipo, 'WARN');
});

test('R-15 · con solo uno previo no dice nada', () => {
  const base = Date.parse('2026-09-15T12:00:00Z');
  const v = evaluarMovimiento(
    mov({ bucket: RECOMPENSAS, categoryId: 'ocio', importeCents: 3000_00, ts: base }),
    { ...CTX, movimientosRecientes: [{ bucket: RECOMPENSAS, tipo: 'gasto', ts: base - 3_600_000 }] },
  );
  assert.equal(v.tipo, 'OK');
});

test('R-16 · no se registran gastos futuros', () => {
  const v = evaluarMovimiento(mov({ localDate: '2026-09-20' }), CTX);
  assert.equal(v.tipo, 'DENY');
  assert.equal(v.ruleId, 'R-16');
  assert.equal(v.anulable, false);
});

test('R-17 · importe absurdo se frena, pero se puede confirmar', () => {
  const v = evaluarMovimiento(mov({ importeCents: 50_000_00 * 200 }), CTX);
  assert.equal(v.ruleId, 'R-17');
  assert.equal(v.anulable, true);
  const r = aplicarVeredicto(mov({ importeCents: 50_000_00 * 200 }), v, { justificacion: 'Es la entrada del coche, confirmado' });
  assert.equal(r.permitido, true);
});

test('R-18 · el mes cerrado es inmutable', () => {
  const v = evaluarMovimiento(mov({ periodId: '2026-08' }), CTX);
  assert.equal(v.tipo, 'DENY');
  assert.equal(v.ruleId, 'R-18');
  assert.equal(v.anulable, false);
  const r = aplicarVeredicto(mov({ periodId: '2026-08' }), v, { justificacion: 'insisto '.repeat(5) });
  assert.equal(r.permitido, false, 'ninguna justificacion abre un mes cerrado');
});

test('R-18 gana a todo lo demas por prioridad', () => {
  const v = evaluarMovimiento(mov({ periodId: '2026-08', categoryId: 'regalo', bucket: ESENCIALES }), CTX);
  assert.equal(v.ruleId, 'R-18');
});

// --- aplicacion del veredicto --------------------------------------------

test('FORCE no se aplica en silencio: primero hay que enseñarlo', () => {
  const m = mov({ categoryId: 'regalo', bucket: ESENCIALES, importeCents: 5000_00 });
  const v = evaluarMovimiento(m, CTX);

  const sinConfirmar = aplicarVeredicto(m, v, {});
  assert.equal(sinConfirmar.permitido, false, 'mover el gasto sin avisar sería el propio autoengaño');
  assert.equal(sinConfirmar.requiere, 'confirmar-destino');

  const confirmado = aplicarVeredicto(m, v, { aceptaForzado: true });
  assert.equal(confirmado.permitido, true);
  assert.equal(confirmado.mov.bucket, RECOMPENSAS);
  assert.equal(confirmado.mov.bucketOriginal, ESENCIALES, 'queda constancia de dónde lo intentó poner');
});

test('un gasto normal pasa sin friccion', () => {
  const v = evaluarMovimiento(mov({ categoryId: 'mercado', comercioTipo: 'supermercado', importeCents: 45_000_00 }), CTX);
  assert.equal(v.tipo, 'OK');
});

test('sugerirDestino · la regla manda sobre el historial', () => {
  const m = mov({ categoryId: 'regalo', bucket: ESENCIALES });
  const v = evaluarMovimiento(m, CTX);
  const s = sugerirDestino(m, v, {});
  assert.equal(s.bucket, RECOMPENSAS);
  assert.equal(s.fuente, 'regla');
});

test('sugerirDestino · sin regla, el historial del comercio', () => {
  const m = mov({ comercio: 'Carnicería Luis' });
  const s = sugerirDestino(m, { tipo: 'OK' }, {
    historialComercio: { 'Carnicería Luis': { bucket: ESENCIALES, categoryId: 'mercado', conteo: 7 } },
  });
  assert.equal(s.fuente, 'historial');
});

test('sugerirDestino · con menos de 3 coincidencias cae al catalogo', () => {
  const m = mov({ comercio: 'Bar nuevo', categoryId: 'restaurante' });
  const s = sugerirDestino(m, { tipo: 'OK' }, {
    historialComercio: { 'Bar nuevo': { bucket: ESENCIALES, categoryId: 'mercado', conteo: 2 } },
  });
  assert.equal(s.fuente, 'catalogo');
  assert.equal(s.bucket, RECOMPENSAS);
});

test('medianaDe', () => {
  assert.equal(medianaDe([]), 0);
  assert.equal(medianaDe([100]), 100);
  assert.equal(medianaDe([100, 300]), 200);
  assert.equal(medianaDe([500, 100, 300]), 300);
});
