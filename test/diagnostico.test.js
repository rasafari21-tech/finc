import test from 'node:test';
import assert from 'node:assert/strict';

import { diagnosticar, proponerRebalanceo, percentil, pendiente, redactarAlerta, ORDEN_RECORTE } from '../src/dominio/diagnostico.js';
import { ESENCIALES, INVERSION, RESERVA, RECOMPENSAS, PESOS_POR_DEFECTO } from '../src/dominio/buckets.js';

const INGRESO = 1_000_000_00; // $1.000.000 en centavos

/**
 * Construye un periodo cerrado con una utilizacion de Esenciales dada.
 *
 * Ojo con la identidad que gobierna esto: con los pesos por defecto, el techo
 * de Esenciales ES el 50 % del ingreso, asi que
 *
 *     gastoEsencial / ingreso  =  utilizacion x 0,50
 *
 * Las dos series no son independientes. Es la razon por la que las cifras
 * ilustrativas del caso 4 de la especificacion (utilizaciones de 0,94 a 1,08
 * junto a un gasto esencial del 62 % del ingreso) no podian darse a la vez:
 * con esas utilizaciones el gasto real ronda el 52 %, no el 62 %. Aqui se usan
 * series consistentes, y la propuesta 62/18/15/5 se conserva con las
 * utilizaciones que de verdad la producen.
 */
function periodoConUtilizacion(id, utilizacion, pesos = PESOS_POR_DEFECTO) {
  const techoEsenciales = Math.round((INGRESO * pesos[ESENCIALES]) / 10_000);
  return {
    id,
    pesos,
    ingresoTotal: INGRESO,
    techos: {
      ESENCIALES: techoEsenciales,
      INVERSION: Math.round((INGRESO * pesos[INVERSION]) / 10_000),
      RESERVA: Math.round((INGRESO * pesos[RESERVA]) / 10_000),
      RECOMPENSAS: Math.round((INGRESO * pesos[RECOMPENSAS]) / 10_000),
    },
    totales: {
      ESENCIALES: Math.round(techoEsenciales * utilizacion),
      INVERSION: 0,
      RESERVA: 0,
      RECOMPENSAS: 0,
    },
  };
}

const serie = (us) => us.map((u, i) => periodoConUtilizacion(`2026-${String(i + 1).padStart(2, '0')}`, u));

// --- utilidades estadisticas ---------------------------------------------

test('percentil · interpolacion lineal', () => {
  assert.equal(percentil([], 75), 0);
  assert.equal(percentil([10], 75), 10);
  assert.equal(percentil([10, 20], 50), 15);
  assert.equal(percentil([1, 2, 3, 4, 5], 50), 3);
  assert.equal(Number(percentil([0.55, 0.57, 0.59, 0.6, 0.62, 0.64], 75).toFixed(4)), 0.615);
});

test('pendiente · regresion lineal', () => {
  assert.equal(pendiente([1, 2, 3, 4]), 1);
  assert.equal(pendiente([4, 3, 2, 1]), -1);
  assert.equal(pendiente([5, 5, 5, 5]), 0);
  assert.equal(pendiente([1]), 0);
});

// --- señales --------------------------------------------------------------

test('no diagnostica con menos de tres periodos: eso es anecdota, no serie', () => {
  assert.equal(diagnosticar(serie([1.2, 1.3])), null);
});

test('un mal mes aislado no dispara nada', () => {
  assert.equal(diagnosticar(serie([0.8, 0.75, 1.08, 0.82, 0.79, 0.81])), null);
});

test('S1 · rebasado tres veces de seis es critico', () => {
  const dx = diagnosticar(serie([0.94, 1.03, 0.98, 1.08, 0.96, 1.05]));
  assert.equal(dx.señal, 'S1');
  assert.equal(dx.severidad, 'CRITICA');
  assert.equal(dx.rebasados, 3);
});

test('S2 · cuatro meses al limite sin rebasar es severidad alta', () => {
  const dx = diagnosticar(serie([0.96, 0.97, 0.85, 0.98, 0.95, 0.88]));
  assert.equal(dx.señal, 'S2');
  assert.equal(dx.severidad, 'ALTA');
  assert.equal(dx.rebasados, 0);
});

test('S3 · deriva sostenida al alza avisa antes de rebasar', () => {
  const dx = diagnosticar(serie([0.70, 0.75, 0.80, 0.85, 0.88, 0.92]));
  assert.equal(dx.señal, 'S3');
  assert.equal(dx.severidad, 'TENDENCIA');
  assert.ok(dx.tendencia >= 0.04);
});

test('S3 no salta si la tendencia sube pero el ultimo mes sigue holgado', () => {
  assert.equal(diagnosticar(serie([0.40, 0.48, 0.56, 0.64, 0.72, 0.80])), null);
});

test('S1 tiene prioridad sobre S2', () => {
  const dx = diagnosticar(serie([1.02, 1.03, 1.04, 0.97, 0.96, 0.98]));
  assert.equal(dx.señal, 'S1');
});

test('solo mira los ultimos seis periodos', () => {
  const larga = serie([1.5, 1.5, 1.5, 1.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
  assert.equal(diagnosticar(larga), null, 'los cuatro desastres antiguos quedan fuera de la ventana');
});

// --- rebalanceo -----------------------------------------------------------

test('rebalanceo · la serie que de verdad produce 62/18/15/5', () => {
  // utilizaciones x 0,50 = ratios 0,55 · 0,62 · 0,57 · 0,64 · 0,59 · 0,60
  // percentil 75 de esos ratios = 0,615 -> techo Esenciales del 62 %
  const dx = diagnosticar(serie([1.10, 1.24, 1.14, 1.28, 1.18, 1.20]));

  assert.equal(dx.severidad, 'CRITICA');
  assert.equal(dx.propuesta.viable, true);
  assert.equal(dx.propuesta.nuevoEsenciales, 62);
  assert.deepEqual(dx.propuesta.propuesto, {
    [ESENCIALES]: 62,
    [INVERSION]: 18,
    [RESERVA]: 15,
    [RECOMPENSAS]: 5,
  });
});

test('rebalanceo · Recompensas se recorta primero, Reserva se protege', () => {
  const dx = diagnosticar(serie([1.10, 1.24, 1.14, 1.28, 1.18, 1.20]));
  const recortes = dx.propuesta.recortes;

  assert.equal(recortes[0].bucket, RECOMPENSAS, 'lo discrecional cae primero');
  assert.equal(recortes[0].puntos, 5, 'hasta su suelo del 5 %');
  assert.equal(recortes[1].bucket, INVERSION);
  assert.equal(recortes[1].puntos, 7);
  assert.equal(recortes.find((r) => r.bucket === RESERVA), undefined, 'Reserva intacta');
});

test('rebalanceo · el orden de recorte y los suelos son los de la especificacion', () => {
  assert.deepEqual(ORDEN_RECORTE, [
    { bucket: RECOMPENSAS, suelo: 5 },
    { bucket: INVERSION, suelo: 10 },
    { bucket: RESERVA, suelo: 10 },
  ]);
});

test('rebalanceo · Reserva solo se toca cuando lo demas ya esta en su suelo', () => {
  // Partiendo de 50/12/30/8, recortar 20 puntos obliga a bajar de Reserva.
  const pesos = { [ESENCIALES]: 5000, [INVERSION]: 1200, [RESERVA]: 3000, [RECOMPENSAS]: 800 };
  const periodos = [1.36, 1.4, 1.38, 1.42, 1.39, 1.41].map((u, i) =>
    periodoConUtilizacion(`2026-0${i + 1}`, u, pesos),
  );
  const p = proponerRebalanceo(periodos, pesos);

  assert.equal(p.viable, true);
  assert.equal(p.propuesto[ESENCIALES], 70, 'tope duro del 70 %');
  assert.equal(p.propuesto[RECOMPENSAS], 5);
  assert.equal(p.propuesto[INVERSION], 10);
  assert.ok(p.propuesto[RESERVA] < 30, 'aqui si hubo que tocar Reserva');
  assert.equal(
    p.propuesto[ESENCIALES] + p.propuesto[INVERSION] + p.propuesto[RESERVA] + p.propuesto[RECOMPENSAS],
    100,
  );
});

test('rebalanceo · siempre suma 100 y nunca baja de los suelos', () => {
  for (let i = 0; i < 500; i++) {
    const us = Array.from({ length: 6 }, () => 0.9 + Math.random() * 0.8);
    const dx = diagnosticar(serie(us));
    if (!dx?.propuesta?.viable) continue;
    const p = dx.propuesta.propuesto;
    assert.equal(p[ESENCIALES] + p[INVERSION] + p[RESERVA] + p[RECOMPENSAS], 100);
    assert.ok(p[RECOMPENSAS] >= 5);
    assert.ok(p[INVERSION] >= 10);
    assert.ok(p[RESERVA] >= 10);
    assert.ok(p[ESENCIALES] >= 50 && p[ESENCIALES] <= 70);
  }
});

test('rebalanceo · el tope del 70 % garantiza que el recorte siempre quepa', () => {
  // available = (Rec-5)+(Inv-10)+(Res-10) = 75 - Esenciales
  // delta     = min(70, p*) - Esenciales  <=  70 - Esenciales
  // luego delta <= available - 5 siempre. La rama no viable es defensiva.
  const dx = diagnosticar(serie([1.4, 1.45, 1.5, 1.42, 1.48, 1.44]));
  assert.equal(dx.propuesta.viable, true);
  assert.equal(dx.propuesta.nuevoEsenciales, 70);
});

test('rebalanceo · no propone nada si el gasto real ya cabe en el techo actual', () => {
  assert.equal(proponerRebalanceo(serie([0.5, 0.6, 0.55])), null);
});

// --- redaccion ------------------------------------------------------------

test('la alerta dice de quien es la culpa y propone cifras concretas', () => {
  const dx = diagnosticar(serie([1.10, 1.24, 1.14, 1.28, 1.18, 1.20]));
  const a = redactarAlerta(dx);

  assert.match(a.titular, /no alcanza/);
  assert.match(a.evidencia, /6 de los últimos 6/);
  assert.match(a.diagnostico, /La regla, no tu comportamiento/);
  assert.equal(a.propuestaTexto, '50/25/15/10 → 62/18/15/5');
  assert.match(a.accionPrimaria, /próximo ciclo/, 'nunca se aplica sola');
});

test('sin diagnostico no hay alerta', () => {
  assert.equal(redactarAlerta(null), null);
});
