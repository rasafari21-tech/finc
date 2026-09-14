/**
 * Escenarios de punta a punta con la pila completa: motor en memoria,
 * repositorio, comandos y reloj falso.
 *
 * Cubren tanto los casos originales de §15 como las mejoras posteriores:
 * ingreso mensual normal, destinos por techo, ingresos informales y sobrante.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { crearMotorMemoria } from '../src/datos/motor-memoria.js';
import { crearBovedaInerte } from '../src/datos/boveda.js';
import { crearRepo } from '../src/datos/repo.js';
import { crearComandos } from '../src/app/comandos.js';
import { relojFalso } from '../src/app/reloj.js';
import { MODO } from '../src/dominio/informales.js';
import { ESENCIALES, INVERSION, RESERVA, RECOMPENSAS, FONDO_AHORRO, CARTERA_INVERSION } from '../src/dominio/buckets.js';

const u = (n) => n * 100;

async function montar(fechaInicial = '2026-08-01T12:00:00Z', { ingresoNormal = null } = {}) {
  const reloj = relojFalso(fechaInicial, 'UTC');
  const motor = await crearMotorMemoria({ persistir: false }).abrir();
  const repo = crearRepo(motor, crearBovedaInerte());
  const comandos = crearComandos(repo, reloj);
  await comandos.arrancar();
  if (ingresoNormal) await comandos.configurarIngresoNormal(ingresoNormal);
  return { reloj, motor, repo, comandos };
}

/** Gasta en tramos repartidos en dias, para no chocar con R-14 ni R-15. */
async function gastarEnTramos(comandos, reloj, { bucket, categoryId, total, tramos, extra = {} }) {
  const porTramo = Math.floor(total / tramos);
  let acumulado = 0;
  for (let i = 0; i < tramos; i++) {
    const importe = i === tramos - 1 ? total - acumulado : porTramo;
    acumulado += importe;
    reloj.avanzarDias(1);
    const r = await comandos.registrarGasto({ importeCents: importe, bucket, categoryId, ...extra });
    assert.equal(r.ok, true, `tramo ${i} de ${bucket}: ${r.veredicto?.ruleId} ${r.veredicto?.mensaje ?? r.faltaDestino}`);
  }
}

// =========================================================================
// Alta e ingreso mensual normal (§14 a §16)
// =========================================================================

test('alta · el ingreso normal se pregunta una vez y entra solo cada mes', async () => {
  const { comandos, reloj, repo } = await montar('2026-08-01T09:00:00Z');

  const arranque = await comandos.arrancar();
  assert.equal(arranque.necesitaAlta, true, 'al principio hay que preguntarlo');

  await comandos.configurarIngresoNormal(u(1_500));

  let p = await comandos.periodoActual();
  assert.deepEqual(p.techos, {
    ESENCIALES: u(750), INVERSION: u(375), RESERVA: u(225), RECOMPENSAS: u(150),
  }, 'el ingreso normal SIGUE repartiéndose 50/25/15/10');

  // Septiembre: entra solo, sin teclear nada
  reloj.fijar('2026-09-01T09:00:00Z');
  await comandos.asegurarPeriodos();

  p = await comandos.periodoActual();
  assert.equal(p.id, '2026-09');
  assert.equal(p.baseFijaAplicada, true);
  assert.equal(p.techos[ESENCIALES], u(750), 'sin intervención del usuario');

  const ajustes = await repo.ajustes();
  assert.equal(ajustes.ingresoNormal.configurado, true);
  assert.equal((await comandos.instantanea()).necesitaAlta, false);
});

test('alta · se puede cambiar después sin tocar el mes en curso', async () => {
  const { comandos, reloj, repo } = await montar('2026-08-01T09:00:00Z', { ingresoNormal: u(1_500) });

  await comandos.configurarIngresoNormal(u(2_000), { aplicarYa: false });
  let p = await comandos.periodoActual();
  assert.equal(p.techos[ESENCIALES], u(750), 'agosto no se recalcula hacia atrás');

  reloj.fijar('2026-09-01T09:00:00Z');
  await comandos.asegurarPeriodos();
  p = await comandos.periodoActual();
  assert.equal(p.techos[ESENCIALES], u(1_000), 'septiembre ya usa el nuevo');

  assert.equal((await repo.ajustes()).ingresoNormal.montoCents, u(2_000));
});

test('alta · quien la salta no recibe asignación automática', async () => {
  const { comandos, repo } = await montar('2026-08-01T09:00:00Z');
  const ajustes = await repo.ajustes();
  await repo.guardarAjustes({ ...ajustes, ingresoNormal: { ...ajustes.ingresoNormal, configurado: true, montoCents: 0 } });

  const p = await comandos.periodoActual();
  assert.equal(p.techos[ESENCIALES], 0, 'los techos crecen solo con lo que registre a mano');
});

// =========================================================================
// Destinos por techo (§2, §3, §4)
// =========================================================================

test('destinos · Reserva se registra directo, sin preguntar nada', async () => {
  const { comandos } = await montar('2026-09-10T09:00:00Z', { ingresoNormal: u(1_500) });

  const r = await comandos.registrarGasto({ bucket: RESERVA, importeCents: u(50) });
  assert.equal(r.ok, true, 'Cachinha es el único destino y se asigna sola');
  assert.equal(r.movimiento.destinoId, 'cachinha');
});

test('destinos · Inversión exige elegir entre Cachinha y otro', async () => {
  const { comandos } = await montar('2026-09-10T09:00:00Z', { ingresoNormal: u(1_500) });

  const sinDestino = await comandos.registrarGasto({ bucket: INVERSION, importeCents: u(50) });
  assert.equal(sinDestino.ok, false);
  assert.equal(sinDestino.faltaDestino, 'DESTINO_DESCONOCIDO');

  const cachinha = await comandos.registrarGasto({ bucket: INVERSION, importeCents: u(50), destinoId: 'cachinha' });
  assert.equal(cachinha.ok, true, 'Cachinha entra sin justificación');
  assert.equal(cachinha.movimiento.categoryId, 'indexado');
});

test('destinos · «otro tipo de inversión» pide especificar', async () => {
  const { comandos } = await montar('2026-09-10T09:00:00Z', { ingresoNormal: u(1_500) });

  const vacio = await comandos.registrarGasto({
    bucket: INVERSION, importeCents: u(80), destinoId: 'otro-inversion',
  });
  assert.equal(vacio.ok, false);
  assert.equal(vacio.faltaDestino, 'FALTA_ESPECIFICAR');
  assert.equal(vacio.etiqueta, 'Especifica');

  const conTexto = await comandos.registrarGasto({
    bucket: INVERSION, importeCents: u(80), destinoId: 'otro-inversion', destinoTexto: 'Tesouro Selic',
  });
  assert.equal(conTexto.ok, true);
  assert.equal(conTexto.movimiento.destinoTexto, 'Tesouro Selic');
});

test('destinos · Recompensa ofrece plan de hotel y otro', async () => {
  const { comandos } = await montar('2026-09-10T09:00:00Z', { ingresoNormal: u(1_500) });

  const hotel = await comandos.registrarGasto({ bucket: RECOMPENSAS, importeCents: u(30), destinoId: 'plan-hotel' });
  assert.equal(hotel.ok, true);

  const otro = await comandos.registrarGasto({
    bucket: RECOMPENSAS, importeCents: u(15), destinoId: 'otro-recompensa', destinoTexto: 'Cine con Ana',
  });
  assert.equal(otro.ok, true);
  assert.equal(otro.movimiento.destinoTexto, 'Cine con Ana');
});

test('destinos · Esenciales sigue con categoría y nota libre', async () => {
  const { comandos } = await montar('2026-09-10T09:00:00Z', { ingresoNormal: u(1_500) });

  const r = await comandos.registrarGasto({
    bucket: ESENCIALES, categoryId: 'mercado', importeCents: u(120), nota: 'Compra de la semana',
  });
  assert.equal(r.ok, true, 'sin destinos: nada cambia');
  assert.equal(r.movimiento.nota, 'Compra de la semana');
});

// =========================================================================
// Ingresos informales (§6 a §10)
// =========================================================================

test('informal · R$20 se reparten mitad y mitad sin preguntar', async () => {
  const { comandos } = await montar('2026-09-10T09:00:00Z', { ingresoNormal: u(1_500) });

  const r = await comandos.registrarIngreso({ importeCents: u(20) });
  assert.equal(r.ok, true);
  assert.equal(r.reparto[INVERSION], u(10));
  assert.equal(r.reparto[RESERVA], u(10));
  assert.equal(r.reparto[ESENCIALES], 0);

  const p = await comandos.periodoActual();
  assert.equal(p.techos[INVERSION], u(375) + u(10), 'el techo crece con el ingreso');
  assert.equal(p.ingresoTotal, u(1_500) + u(20));
});

test('informal · R$70 pregunta antes de tocar nada', async () => {
  const { comandos, repo } = await montar('2026-09-10T09:00:00Z', { ingresoNormal: u(1_500) });
  const antes = await comandos.periodoActual();

  const r = await comandos.registrarIngreso({ importeCents: u(70) });
  assert.equal(r.ok, false);
  assert.equal(r.requierePreguntar, true);
  assert.equal(r.opciones.length, 3);

  const despues = await comandos.periodoActual();
  assert.deepEqual(despues.techos, antes.techos, 'no se escribió nada mientras pregunta');

  const mitades = r.opciones.find((o) => o.id === MODO.MITADES);
  assert.equal(mitades.reparto.partes[RESERVA], u(35));
  assert.equal(mitades.reparto.partes[INVERSION], u(35));

  // El usuario elige
  const elegido = await comandos.registrarIngreso({ importeCents: u(70), modo: MODO.MITADES });
  assert.equal(elegido.ok, true);
  assert.equal(elegido.reparto[RESERVA], u(35));

  const movs = await repo.movimientos({ periodId: despues.id });
  assert.equal(movs.filter((m) => m.claseIngreso === 'informal').length, 1, 'un solo movimiento, no dos');
});

test('informal · repartir entre las cuatro usa el reparto habitual', async () => {
  const { comandos } = await montar('2026-09-10T09:00:00Z', { ingresoNormal: u(1_500) });

  const r = await comandos.registrarIngreso({ importeCents: u(200), modo: MODO.CUATRO });
  assert.equal(r.ok, true);
  assert.deepEqual(r.reparto, {
    ESENCIALES: u(100), INVERSION: u(50), RESERVA: u(30), RECOMPENSAS: u(20),
  });
});

test('informal · elegir a mano lo manda entero a un solo techo', async () => {
  const { comandos } = await montar('2026-09-10T09:00:00Z', { ingresoNormal: u(1_500) });

  const r = await comandos.registrarIngreso({
    importeCents: u(70), modo: MODO.MANUAL, bucketManual: RECOMPENSAS,
  });
  assert.equal(r.reparto[RECOMPENSAS], u(70));
  assert.equal(r.reparto[RESERVA], 0);
});

test('informal · el ejemplo del punto 6: R$20 cuando ya se gastó de todo', async () => {
  const { comandos, reloj } = await montar('2026-09-01T09:00:00Z', { ingresoNormal: u(1_000) });

  // Techos: 500 / 250 / 150 / 100. Se agota Esenciales e Inversión y parte de Reserva.
  await gastarEnTramos(comandos, reloj, { bucket: ESENCIALES, categoryId: 'mercado', total: u(500), tramos: 5 });
  await gastarEnTramos(comandos, reloj, { bucket: INVERSION, total: u(250), tramos: 5, extra: { destinoId: 'cachinha' } });
  await comandos.registrarGasto({ bucket: RESERVA, importeCents: u(30) });

  const r = await comandos.registrarIngreso({ importeCents: u(20) });
  assert.equal(r.ok, true);
  const p = await comandos.periodoActual();

  assert.equal(p.ingresoTotal, u(1_020), 'los R$20 entran al cálculo del mes');
  assert.equal(
    r.reparto[INVERSION] + r.reparto[RESERVA] + r.reparto[ESENCIALES] + r.reparto[RECOMPENSAS],
    u(20),
    'ningún real queda suelto',
  );
});

test('informal · si un techo está en rojo, el dinero nuevo lo tapa primero', async () => {
  const { comandos, reloj } = await montar('2026-09-01T09:00:00Z', { ingresoNormal: u(1_000) });

  // Esenciales tiene techo 500; se gastan 530
  await gastarEnTramos(comandos, reloj, { bucket: ESENCIALES, categoryId: 'mercado', total: u(530), tramos: 6 });

  const r = await comandos.registrarIngreso({ importeCents: u(20) });
  assert.equal(r.detalleReparto.ajuste, 'TAPA_DEFICIT');
  assert.equal(r.reparto[ESENCIALES], u(20), 'va a tapar, no a Reserva');
});

test('informal · nunca produce céntimos sueltos', async () => {
  const { comandos } = await montar('2026-09-10T09:00:00Z', { ingresoNormal: u(1_500) });

  for (const reales of [7, 13, 21, 33, 41]) {
    const r = await comandos.registrarIngreso({ importeCents: u(reales) });
    for (const b of [ESENCIALES, INVERSION, RESERVA, RECOMPENSAS]) {
      assert.equal(r.reparto[b] % 100, 0, `R$${reales} dejó céntimos en ${b}`);
    }
  }
});

// =========================================================================
// Cierre de mes (§15 caso 2, con el ingreso normal)
// =========================================================================

test('cierre · reproduce el caso 2 con el ingreso mensual normal', async () => {
  const { comandos, reloj, repo } = await montar('2026-08-01T09:00:00Z', { ingresoNormal: u(1_240_000) });

  let p = await comandos.periodoActual();
  assert.deepEqual(p.techos, {
    ESENCIALES: u(620_000), INVERSION: u(310_000), RESERVA: u(186_000), RECOMPENSAS: u(124_000),
  });

  await gastarEnTramos(comandos, reloj, { bucket: ESENCIALES, categoryId: 'mercado', total: u(651_400), tramos: 6 });
  await gastarEnTramos(comandos, reloj, { bucket: INVERSION, total: u(310_000), tramos: 5, extra: { destinoId: 'cachinha' } });
  reloj.fijar('2026-08-20T10:00:00Z');
  await comandos.registrarGasto({ bucket: RESERVA, importeCents: u(42_000) });
  await gastarEnTramos(comandos, reloj, { bucket: RECOMPENSAS, total: u(118_700), tramos: 5, extra: { destinoId: 'plan-hotel' } });

  reloj.fijar('2026-09-03T08:12:00Z');
  const cierres = await comandos.asegurarPeriodos();

  assert.equal(cierres.length, 1);
  const informe = cierres[0].informe;

  const esenciales = informe.porBucket.find((b) => b.bucket === ESENCIALES);
  assert.equal(Math.round(esenciales.utilizacion * 100), 105);
  assert.equal(esenciales.excesoCents, u(31_400));

  const reserva = informe.porBucket.find((b) => b.bucket === RESERVA);
  assert.equal(reserva.remanenteCents, u(144_000));
  assert.equal(reserva.destinoRemanente, FONDO_AHORRO);

  const fondos = await repo.fondos();
  assert.equal(fondos[FONDO_AHORRO].saldoCents, u(144_000));

  const nuevo = await comandos.periodoActual();
  assert.equal(nuevo.id, '2026-09');
  assert.equal(nuevo.techos[ESENCIALES], u(620_000), 'septiembre abre con el ingreso normal ya aplicado');
  assert.deepEqual(nuevo.totales, { ESENCIALES: 0, INVERSION: 0, RESERVA: 0, RECOMPENSAS: 0 });

  const rechazo = await comandos.registrarGasto({
    bucket: ESENCIALES, categoryId: 'mercado', importeCents: u(100), periodId: '2026-08',
  });
  assert.equal(rechazo.ok, false);
  assert.equal(rechazo.veredicto.ruleId, 'R-18');
});

test('cierre · sigue siendo idempotente', async () => {
  const { comandos, reloj, repo } = await montar('2026-08-10T09:00:00Z', { ingresoNormal: u(1_000) });

  reloj.fijar('2026-09-05T09:00:00Z');
  const tandas = await Promise.all([
    comandos.asegurarPeriodos(), comandos.asegurarPeriodos(), comandos.asegurarPeriodos(),
    comandos.asegurarPeriodos(), comandos.asegurarPeriodos(),
  ]);

  assert.deepEqual([...new Set(tandas.flat().map((c) => c.periodId))], ['2026-08']);
  assert.equal((await repo.entradasFondo(FONDO_AHORRO)).length, 1);
  assert.equal((await repo.periodosCerrados()).length, 1);
  assert.equal((await repo.sobrantes()).length, 1, 'un solo registro de sobrante');
});

test('cierre · tres meses sin abrir se cierran en cadena', async () => {
  const { comandos, reloj, repo } = await montar('2026-08-05T09:00:00Z', { ingresoNormal: u(400) });

  reloj.fijar('2026-11-04T09:00:00Z');
  const cierres = await comandos.asegurarPeriodos();

  assert.deepEqual(cierres.map((c) => c.periodId), ['2026-08', '2026-09', '2026-10']);
  assert.equal((await comandos.periodoActual()).id, '2026-11');
  assert.equal((await repo.sobrantes()).length, 3, 'un sobrante por mes cerrado');
});

// =========================================================================
// Sobrante mensual (§11 a §13)
// =========================================================================

test('sobrante · se calcula al cerrar y queda registrado', async () => {
  const { comandos, reloj, repo } = await montar('2026-09-01T09:00:00Z', { ingresoNormal: u(1_000) });

  // Techos 500/250/150/100. Se gasta parte de Esenciales y de Recompensas.
  await gastarEnTramos(comandos, reloj, { bucket: ESENCIALES, categoryId: 'mercado', total: u(460), tramos: 5 });
  await gastarEnTramos(comandos, reloj, { bucket: RECOMPENSAS, total: u(80), tramos: 4, extra: { destinoId: 'plan-hotel' } });

  reloj.fijar('2026-10-02T09:00:00Z');
  const [cierre] = await comandos.asegurarPeriodos();

  // Libres: Esenciales 40 + Recompensas 20 = 60
  assert.equal(cierre.sobrante.sobranteCents, u(60));
  assert.equal(cierre.informe.sobranteCents, u(60));

  const registro = await repo.sobrante('2026-09');
  assert.equal(registro.sobranteCents, u(60));
  assert.equal(registro.destino, null, 'todavía sin decidir');
});

test('sobrante · invertirlo NO cambia el historial', async () => {
  const { comandos, reloj, repo } = await montar('2026-09-01T09:00:00Z', { ingresoNormal: u(1_000) });
  await gastarEnTramos(comandos, reloj, { bucket: ESENCIALES, categoryId: 'mercado', total: u(460), tramos: 5 });
  await gastarEnTramos(comandos, reloj, { bucket: RECOMPENSAS, total: u(80), tramos: 4, extra: { destinoId: 'plan-hotel' } });

  reloj.fijar('2026-10-02T09:00:00Z');
  await comandos.asegurarPeriodos();

  const r = await comandos.resolverSobrante('2026-09', 'INVERSION');
  assert.equal(r.ok, true);

  const registro = await repo.sobrante('2026-09');
  assert.equal(registro.sobranteCents, u(60), 'septiembre sobraron R$60, pase lo que pase después');
  assert.equal(registro.destino, 'INVERSION');

  const fondos = await repo.fondos();
  assert.equal(fondos[CARTERA_INVERSION].saldoCents >= u(60), true, 'el dinero sí se movió');

  const repetido = await comandos.resolverSobrante('2026-09', 'RESERVA');
  assert.equal(repetido.ok, false);
  assert.equal(repetido.codigo, 'YA_RESUELTO', 'no se decide dos veces');
});

test('sobrante · el historial acumula un mes por cierre', async () => {
  const { comandos, reloj } = await montar('2026-07-01T09:00:00Z', { ingresoNormal: u(1_000) });

  reloj.fijar('2026-10-02T09:00:00Z');
  await comandos.asegurarPeriodos();

  const { registros, media } = await comandos.historialSobrantes();
  assert.equal(registros.length, 3, 'julio, agosto y septiembre');
  assert.deepEqual(registros.map((r) => r.periodId), ['2026-09', '2026-08', '2026-07']);
  assert.equal(media, u(600), 'sin gastar nada, sobran los techos libres enteros: 500 + 100');
});

test('sobrante · avisa la víspera del cierre con la cifra del mes en curso', async () => {
  const { comandos, reloj } = await montar('2026-09-01T09:00:00Z', { ingresoNormal: u(1_000) });
  await gastarEnTramos(comandos, reloj, { bucket: ESENCIALES, categoryId: 'mercado', total: u(460), tramos: 5 });

  reloj.fijar('2026-09-15T09:00:00Z');
  assert.equal((await comandos.sobranteDelMes()).vispera, false);

  reloj.fijar('2026-09-29T09:00:00Z');
  const s = await comandos.sobranteDelMes();
  assert.equal(s.vispera, true, 'el día 29 de un mes de 30 ya avisa');
  assert.equal(s.sobranteCents, u(140), 'Esenciales 40 + Recompensas 100');
});

// =========================================================================
// Comportamiento que no debía cambiar
// =========================================================================

test('el sobregasto se sigue registrando, nunca se bloquea', async () => {
  const { comandos, reloj } = await montar('2026-09-01T09:00:00Z', { ingresoNormal: u(1_000) });
  await gastarEnTramos(comandos, reloj, { bucket: ESENCIALES, categoryId: 'mercado', total: u(600), tramos: 6 });

  const p = await comandos.periodoActual();
  assert.equal(p.totales[ESENCIALES], u(600));
  assert.ok(p.totales[ESENCIALES] > p.techos[ESENCIALES]);
});

test('las reglas siguen bloqueando lo que tienen que bloquear', async () => {
  const { comandos } = await montar('2026-09-10T09:00:00Z', { ingresoNormal: u(1_500) });

  const regalo = await comandos.registrarGasto({ bucket: ESENCIALES, categoryId: 'regalo', importeCents: u(45) });
  assert.equal(regalo.ok, false);
  assert.equal(regalo.veredicto.ruleId, 'R-01');
  assert.equal(regalo.sugerencia.bucket, RECOMPENSAS);
});

test('deshacer sigue funcionando dentro de la ventana', async () => {
  const { comandos, reloj } = await montar('2026-09-10T09:00:00Z', { ingresoNormal: u(1_000) });

  const r = await comandos.registrarGasto({ bucket: ESENCIALES, categoryId: 'mercado', importeCents: u(50) });
  assert.equal((await comandos.periodoActual()).totales[ESENCIALES], u(50));

  assert.equal((await comandos.deshacer(r.movimiento.id)).ok, true);
  assert.equal((await comandos.periodoActual()).totales[ESENCIALES], 0);

  const otro = await comandos.registrarGasto({ bucket: ESENCIALES, categoryId: 'mercado', importeCents: u(30) });
  reloj.avanzarHoras(1);
  assert.equal((await comandos.deshacer(otro.movimiento.id)).motivo, 'FUERA_DE_PLAZO');
});

test('la instantánea trae todo lo que la interfaz necesita', async () => {
  const { comandos } = await montar('2026-09-10T09:00:00Z', { ingresoNormal: u(1_000) });
  await comandos.registrarGasto({ bucket: ESENCIALES, categoryId: 'mercado', importeCents: u(50) });

  const s = await comandos.instantanea();
  assert.equal(s.periodo.id, '2026-09');
  assert.equal(s.necesitaAlta, false);
  assert.ok(s.fondos[FONDO_AHORRO]);
  assert.ok(s.sobrante, 'el sobrante proyectado viene siempre');
  assert.deepEqual(s.sobrantes, [], 'sin meses cerrados todavía');
  assert.equal(s.sobrantePendiente, null);
  assert.equal(s.fecha, '2026-09-10');
});

// =========================================================================
// Invariante de producto: solo se escribe texto en Esenciales, o al pulsar «Otro»
// =========================================================================

test('NUNCA se pide escribir nada en Reserva, Inversión ni Recompensas', async () => {
  const { comandos, reloj } = await montar('2026-09-02T09:00:00Z', { ingresoNormal: u(1_000) });

  // Casos que antes obligaban a redactar: importe enorme respecto al techo,
  // racha de caprichos, importe atipico. Ninguno debe pedir texto.
  const intentos = [
    { bucket: RESERVA, importeCents: u(140) },
    { bucket: RESERVA, importeCents: u(149) },
    { bucket: INVERSION, importeCents: u(200), destinoId: 'cachinha' },
    { bucket: INVERSION, importeCents: u(240), destinoId: 'cachinha' },
    { bucket: RECOMPENSAS, importeCents: u(90), destinoId: 'plan-hotel' },
    { bucket: RECOMPENSAS, importeCents: u(5), destinoId: 'plan-hotel' },
    { bucket: RECOMPENSAS, importeCents: u(5), destinoId: 'plan-hotel' },
    { bucket: RECOMPENSAS, importeCents: u(5), destinoId: 'plan-hotel' },
  ];

  for (const [i, cmd] of intentos.entries()) {
    reloj.avanzarHoras(1);
    const r = await comandos.registrarGasto(cmd);
    assert.notEqual(r.requiere, 'justificacion', `intento ${i} (${cmd.bucket}) pidió justificación`);
    assert.notEqual(r.requiere, 'evidencia', `intento ${i} (${cmd.bucket}) pidió evidencia`);
    assert.notEqual(r.faltaDestino, 'FALTA_ESPECIFICAR', `intento ${i} pidió especificar sin haber pulsado «Otro»`);
    assert.equal(r.ok, true, `intento ${i} (${cmd.bucket}) quedó bloqueado: ${r.veredicto?.ruleId}`);
  }
});

test('el único texto obligatorio llega al pulsar «Otro»', async () => {
  const { comandos } = await montar('2026-09-10T09:00:00Z', { ingresoNormal: u(1_000) });

  const sinTexto = await comandos.registrarGasto({
    bucket: RECOMPENSAS, importeCents: u(20), destinoId: 'otro-recompensa',
  });
  assert.equal(sinTexto.faltaDestino, 'FALTA_ESPECIFICAR', 'solo aquí se escribe');
  assert.equal(sinTexto.etiqueta, 'Especifica');

  const conTexto = await comandos.registrarGasto({
    bucket: RECOMPENSAS, importeCents: u(20), destinoId: 'otro-recompensa', destinoTexto: 'Concierto',
  });
  assert.equal(conTexto.ok, true);
});

test('un importe absurdo se confirma con un toque, sin redactar', async () => {
  const { comandos, reloj } = await montar('2026-09-02T09:00:00Z', { ingresoNormal: u(1_000) });

  // Historial normal, para que exista mediana
  for (const n of [30, 25, 40, 35, 28]) {
    reloj.avanzarDias(1);
    await comandos.registrarGasto({ bucket: ESENCIALES, categoryId: 'mercado', importeCents: u(n) });
  }

  const gordo = await comandos.registrarGasto({ bucket: ESENCIALES, categoryId: 'mercado', importeCents: u(9_000) });
  assert.equal(gordo.ok, false);
  assert.equal(gordo.veredicto.ruleId, 'R-17');
  assert.equal(gordo.requiere, 'confirmacion', 'un sí o un no, no un texto');

  const confirmado = await comandos.registrarGasto({
    bucket: ESENCIALES, categoryId: 'mercado', importeCents: u(9_000), confirmado: true,
  });
  assert.equal(confirmado.ok, true);
});

test('el aviso de R-14 se registra pero deja pasar', async () => {
  const { comandos } = await montar('2026-09-10T09:00:00Z', { ingresoNormal: u(1_000) });

  // Techo de Esenciales 500; mas de 125 dispara R-14
  const r = await comandos.registrarGasto({ bucket: ESENCIALES, categoryId: 'vivienda', importeCents: u(300) });
  assert.equal(r.ok, true, 'el alquiler es mas de un cuarto del techo y eso es lo normal');
  assert.equal(r.aviso?.ruleId, 'R-14');
  assert.equal((await comandos.periodoActual()).totales[ESENCIALES], u(300));
});
