import test from 'node:test';
import assert from 'node:assert/strict';

import { periodosPendientes, planificarCierre, planificarIngresoNormal } from '../src/dominio/cierre.js';
import { calcularCarry, POLITICA_POR_DEFECTO, EXPIRA } from '../src/dominio/carry.js';
import { crearPeriodo, fechaLocal, periodoDe, siguientePeriodo, anteriorPeriodo, diasEnPeriodo } from '../src/dominio/periodo.js';
import { ESENCIALES, INVERSION, RESERVA, RECOMPENSAS, FONDO_AHORRO, CARTERA_INVERSION } from '../src/dominio/buckets.js';

const u = (n) => n * 100; // unidades a centavos
const ZONA = 'America/Bogota'; // UTC-5 todo el año, sin horario de verano

// --- frontera de fecha local ---------------------------------------------

test('fecha local · el periodo deriva de la hora del usuario, no de UTC', () => {
  // 31 de agosto a las 23:40 en Bogotá = 1 de septiembre 04:40 UTC
  const ts = Date.parse('2026-09-01T04:40:00Z');
  assert.equal(fechaLocal(ts, ZONA), '2026-08-31');
  assert.equal(periodoDe(ts, ZONA), '2026-08', 'debe caer en agosto, no en septiembre');
  assert.equal(periodoDe(ts, 'UTC'), '2026-09', 'en UTC si seria septiembre');
});

test('fecha local · el primer instante del mes tambien cuadra', () => {
  const ts = Date.parse('2026-09-01T05:00:00Z'); // 00:00 en Bogotá
  assert.equal(fechaLocal(ts, ZONA), '2026-09-01');
  assert.equal(periodoDe(ts, ZONA), '2026-09');
});

test('aritmetica de periodos', () => {
  assert.equal(siguientePeriodo('2026-12'), '2027-01');
  assert.equal(anteriorPeriodo('2026-01'), '2025-12');
  assert.equal(diasEnPeriodo('2026-02'), 28);
  assert.equal(diasEnPeriodo('2028-02'), 29, 'año bisiesto');
  assert.equal(diasEnPeriodo('2026-09'), 30);
});

// --- reloj perezoso -------------------------------------------------------

test('periodosPendientes · el caso normal no devuelve nada', () => {
  const ahora = Date.parse('2026-09-15T17:00:00Z');
  assert.deepEqual(periodosPendientes('2026-08', ahora, ZONA), []);
});

test('periodosPendientes · abrir el dia 3 cierra el mes anterior', () => {
  const ahora = Date.parse('2026-09-03T13:12:00Z');
  assert.deepEqual(periodosPendientes('2026-07', ahora, ZONA), ['2026-08']);
});

test('periodosPendientes · tres meses sin abrir se cierran en orden', () => {
  const ahora = Date.parse('2026-12-05T15:00:00Z');
  assert.deepEqual(periodosPendientes('2026-08', ahora, ZONA), ['2026-09', '2026-10', '2026-11']);
});

test('periodosPendientes · cruzando el año', () => {
  const ahora = Date.parse('2027-02-02T15:00:00Z');
  assert.deepEqual(periodosPendientes('2026-11', ahora, ZONA), ['2026-12', '2027-01']);
});

test('periodosPendientes · sin historial previo arranca del primer periodo con datos', () => {
  const ahora = Date.parse('2026-09-15T17:00:00Z');
  assert.deepEqual(periodosPendientes(null, ahora, ZONA, '2026-07'), ['2026-07', '2026-08']);
  assert.deepEqual(periodosPendientes(null, ahora, ZONA, null), []);
});

test('periodosPendientes · el ultimo instante del mes local aun NO cierra', () => {
  const ahora = Date.parse('2026-09-01T04:59:00Z'); // 31 ago 23:59 en Bogotá
  assert.deepEqual(periodosPendientes('2026-07', ahora, ZONA), [], 'agosto sigue abierto');
});

// --- carry-forward --------------------------------------------------------

function periodoConCifras({ techos, totales, ingresoTotal = 0, id = '2026-08' }) {
  return { ...crearPeriodo(id), techos, totales, ingresoTotal };
}

test('carry · solo Reserva alimenta el Fondo; Recompensas expira', () => {
  const p = periodoConCifras({
    techos: { ESENCIALES: u(620_000), INVERSION: u(310_000), RESERVA: u(186_000), RECOMPENSAS: u(124_000) },
    totales: { ESENCIALES: u(651_400), INVERSION: u(310_000), RESERVA: u(42_000), RECOMPENSAS: u(118_700) },
  });
  const c = calcularCarry(p, POLITICA_POR_DEFECTO);

  assert.equal(c.aFondo, u(144_000), 'remanente de Reserva al Fondo');
  assert.equal(c.aCartera, 0, 'Inversion quedo a cero, no consolida nada');
  assert.equal(c.expirado, u(5_300), 'el remanente de Recompensas expira');
  assert.deepEqual(c.sobrepasos, [{ bucket: ESENCIALES, excesoCents: u(31_400) }]);
});

test('carry · Inversion consolida en su propia cartera', () => {
  const p = periodoConCifras({
    techos: { ESENCIALES: u(100), INVERSION: u(100), RESERVA: u(100), RECOMPENSAS: u(100) },
    totales: { ESENCIALES: u(100), INVERSION: u(40), RESERVA: u(100), RECOMPENSAS: u(100) },
  });
  const c = calcularCarry(p);
  assert.equal(c.aCartera, u(60));
  assert.equal(c.aFondo, 0);
});

test('carry · el destino de Reserva y Recompensas no se puede cambiar', () => {
  const p = periodoConCifras({
    techos: { ESENCIALES: u(100), INVERSION: u(100), RESERVA: u(100), RECOMPENSAS: u(100) },
    totales: { ESENCIALES: u(100), INVERSION: u(100), RESERVA: 0, RECOMPENSAS: 0 },
  });
  // Se intenta forzar politicas contrarias al requisito del producto:
  const c = calcularCarry(p, { [RESERVA]: EXPIRA, [RECOMPENSAS]: FONDO_AHORRO });
  assert.equal(c.aFondo, u(100), 'Reserva sigue yendo al Fondo');
  assert.equal(c.expirado, u(100), 'Recompensas sigue expirando');
});

test('carry · Esenciales puede redirigirse a Reserva si el usuario quiere', () => {
  const p = periodoConCifras({
    techos: { ESENCIALES: u(100), INVERSION: 0, RESERVA: 0, RECOMPENSAS: 0 },
    totales: { ESENCIALES: u(30), INVERSION: 0, RESERVA: 0, RECOMPENSAS: 0 },
  });
  assert.equal(calcularCarry(p, { [ESENCIALES]: RESERVA }).aReservaSiguiente, u(70));
  assert.equal(calcularCarry(p).expirado, u(70), 'por defecto expira');
});

// --- cierre completo ------------------------------------------------------

function movsYAsignaciones(techos, totales) {
  const asignaciones = Object.entries(techos)
    .filter(([, v]) => v > 0)
    .map(([bucket, centavos], i) => ({ id: `a${i}`, bucket, centavos, periodId: '2026-08' }));
  const movimientos = Object.entries(totales)
    .filter(([, v]) => v > 0)
    .map(([bucket, importeCents], i) => ({
      id: `m${i}`,
      tipo: 'gasto',
      bucket,
      importeCents,
      periodId: '2026-08',
      localDate: '2026-08-15',
    }));
  const ingreso = Object.values(techos).reduce((a, b) => a + b, 0);
  movimientos.push({
    id: 'ing',
    tipo: 'ingreso',
    importeCents: ingreso,
    periodId: '2026-08',
    localDate: '2026-08-01',
  });
  return { movimientos, asignaciones };
}

test('cierre · reproduce el caso 2 de la especificacion §15', () => {
  const techos = { ESENCIALES: u(620_000), INVERSION: u(310_000), RESERVA: u(186_000), RECOMPENSAS: u(124_000) };
  const totales = { ESENCIALES: u(651_400), INVERSION: u(310_000), RESERVA: u(42_000), RECOMPENSAS: u(118_700) };
  const { movimientos, asignaciones } = movsYAsignaciones(techos, totales);

  const p = periodoConCifras({ techos, totales, ingresoTotal: u(1_240_000) });
  const plan = planificarCierre(p, movimientos, asignaciones, { ahora: Date.parse('2026-09-03T13:12:00Z') });

  assert.equal(plan.periodoCerrado.status, 'cerrado');
  assert.equal(plan.periodoNuevo.id, '2026-09');
  assert.deepEqual(plan.periodoNuevo.totales, { ESENCIALES: 0, INVERSION: 0, RESERVA: 0, RECOMPENSAS: 0 });
  assert.deepEqual(plan.periodoNuevo.techos, { ESENCIALES: 0, INVERSION: 0, RESERVA: 0, RECOMPENSAS: 0 });

  const alFondo = plan.entradasFondo.find((e) => e.fundId === FONDO_AHORRO);
  assert.equal(alFondo.delta, u(144_000));
  assert.equal(plan.entradasFondo.find((e) => e.fundId === CARTERA_INVERSION), undefined);

  const esenciales = plan.informe.porBucket.find((b) => b.bucket === ESENCIALES);
  assert.equal(esenciales.excesoCents, u(31_400));
  assert.equal(Math.round(esenciales.utilizacion * 100), 105);

  const recompensas = plan.informe.porBucket.find((b) => b.bucket === RECOMPENSAS);
  assert.equal(recompensas.remanenteCents, u(5_300));
  assert.equal(recompensas.destinoRemanente, EXPIRA);
});

test('cierre · detecta que los totales materializados se desviaron', () => {
  const techos = { ESENCIALES: u(100), INVERSION: 0, RESERVA: 0, RECOMPENSAS: 0 };
  const totales = { ESENCIALES: u(40), INVERSION: 0, RESERVA: 0, RECOMPENSAS: 0 };
  const { movimientos, asignaciones } = movsYAsignaciones(techos, totales);

  // El periodo guardado miente: dice 90 gastados cuando los movimientos dicen 40.
  const p = periodoConCifras({ techos, totales: { ...totales, ESENCIALES: u(90) } });
  const plan = planificarCierre(p, movimientos, asignaciones);

  assert.equal(plan.descuadre.hay, true);
  assert.equal(plan.periodoCerrado.totales.ESENCIALES, u(40), 'gana el recalculo');
});

test('cierre · el remanente redirigido a Reserva llega al mes siguiente', () => {
  const techos = { ESENCIALES: u(1000), INVERSION: 0, RESERVA: 0, RECOMPENSAS: 0 };
  const totales = { ESENCIALES: u(400), INVERSION: 0, RESERVA: 0, RECOMPENSAS: 0 };
  const { movimientos, asignaciones } = movsYAsignaciones(techos, totales);
  const p = periodoConCifras({ techos, totales });

  const plan = planificarCierre(p, movimientos, asignaciones, { politicaCarry: { [ESENCIALES]: RESERVA } });
  assert.equal(plan.periodoNuevo.carryIn, u(600));
  assert.equal(plan.periodoNuevo.techos.RESERVA, u(600));
});

test('cierre · el informe lista los cobros que se quedaron a medias', () => {
  const techos = { ESENCIALES: u(100), INVERSION: 0, RESERVA: 0, RECOMPENSAS: 0 };
  const { movimientos, asignaciones } = movsYAsignaciones(techos, { ESENCIALES: u(50), INVERSION: 0, RESERVA: 0, RECOMPENSAS: 0 });
  movimientos.push({
    id: 'parcial',
    tipo: 'ingreso',
    importeCents: u(120_000),
    grupoLiquidacion: 'cita-ana',
    totalPactadoCents: u(200_000),
    periodId: '2026-08',
    localDate: '2026-08-08',
  });

  const p = periodoConCifras({ techos, totales: { ESENCIALES: u(50), INVERSION: 0, RESERVA: 0, RECOMPENSAS: 0 } });
  const plan = planificarCierre(p, movimientos, asignaciones);

  assert.equal(plan.informe.cobrosIncompletos.length, 1);
  assert.equal(plan.informe.cobrosIncompletos[0].pendiente, u(80_000));
});

test('cierre · el informe cuenta los choques con cada regla', () => {
  const techos = { ESENCIALES: u(100), INVERSION: 0, RESERVA: 0, RECOMPENSAS: 0 };
  const { movimientos, asignaciones } = movsYAsignaciones(techos, { ESENCIALES: u(50), INVERSION: 0, RESERVA: 0, RECOMPENSAS: 0 });
  const eventos = [
    { tipo: 'REGLA_FORZADO', ruleId: 'R-01' },
    { tipo: 'REGLA_FORZADO', ruleId: 'R-01' },
    { tipo: 'REGLA_RECHAZO', ruleId: 'R-08' },
    { tipo: 'REGLA_ANULADA', ruleId: 'R-14' },
  ];
  const p = periodoConCifras({ techos, totales: { ESENCIALES: u(50), INVERSION: 0, RESERVA: 0, RECOMPENSAS: 0 } });
  const plan = planificarCierre(p, movimientos, asignaciones, { eventos });

  assert.equal(plan.informe.reglas.forzados, 2);
  assert.equal(plan.informe.reglas.rechazos, 1);
  assert.equal(plan.informe.reglas.excepciones, 1);
  assert.equal(plan.informe.reglas.porRegla['R-01'], 2);
});

// --- base fija ------------------------------------------------------------

test('ingreso normal · no se aplica dos veces al mismo periodo', () => {
  const p = crearPeriodo('2026-09');
  const normal = { configurado: true, montoCents: u(1_500) };

  assert.ok(planificarIngresoNormal(p, normal), 'la primera vez si');
  assert.equal(planificarIngresoNormal({ ...p, baseFijaAplicada: true }, normal), null, 'la segunda no');
  assert.equal(planificarIngresoNormal(p, { ...normal, configurado: false }), null);
  assert.equal(planificarIngresoNormal(p, { configurado: true, montoCents: 0 }), null,
    'quien lo salta en el alta no recibe ninguna asignacion automatica');
});
