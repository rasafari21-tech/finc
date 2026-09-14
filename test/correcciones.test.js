/**
 * Corregir lo ya registrado y restaurar copias (UX-01, UX-03).
 *
 * El ledger es inmutable a proposito, pero eso no puede significar que un cero
 * de mas quede grabado para siempre. Esto fija donde acaba la inmutabilidad:
 * en el mes abierto se corrige, en el cerrado no.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { crearMotorMemoria } from '../src/datos/motor-memoria.js';
import { crearBovedaInerte } from '../src/datos/boveda.js';
import { crearRepo } from '../src/datos/repo.js';
import { crearComandos } from '../src/app/comandos.js';
import { relojFalso } from '../src/app/reloj.js';
import { ESENCIALES, INVERSION, RESERVA, RECOMPENSAS, FONDO_AHORRO } from '../src/dominio/buckets.js';

const u = (n) => n * 100;

async function montar(fecha = '2026-09-10T09:00:00Z', ingreso = u(1_000)) {
  const reloj = relojFalso(fecha, 'UTC');
  const motor = await crearMotorMemoria({ persistir: false }).abrir();
  const repo = crearRepo(motor, crearBovedaInerte());
  const comandos = crearComandos(repo, reloj);
  await comandos.arrancar();
  if (ingreso) await comandos.configurarIngresoNormal(ingreso);
  return { reloj, motor, repo, comandos };
}

// =========================================================================
// Corregir (UX-01)
// =========================================================================

test('un error de tecleo se corrige y el techo vuelve a cuadrar', async () => {
  const { comandos } = await montar();

  // R$450 donde querias R$45. El techo de Esenciales es 500.
  const gordo = await comandos.registrarGasto({
    bucket: ESENCIALES, categoryId: 'mercado', importeCents: u(450), confirmado: true,
  });
  assert.equal(gordo.ok, true);
  assert.equal((await comandos.periodoActual()).totales[ESENCIALES], u(450));

  const r = await comandos.editarMovimiento(gordo.movimiento.id, { importeCents: u(45) });
  assert.equal(r.ok, true);

  const p = await comandos.periodoActual();
  assert.equal(p.totales[ESENCIALES], u(45), 'el total se recalcula, no se queda el viejo');
});

test('anular devuelve el techo al estado anterior', async () => {
  const { comandos } = await montar();

  await comandos.registrarGasto({ bucket: ESENCIALES, categoryId: 'mercado', importeCents: u(30) });
  const segundo = await comandos.registrarGasto({ bucket: ESENCIALES, categoryId: 'mercado', importeCents: u(50) });
  assert.equal((await comandos.periodoActual()).totales[ESENCIALES], u(80));

  const r = await comandos.anularMovimiento(segundo.movimiento.id);
  assert.equal(r.ok, true);
  assert.equal((await comandos.periodoActual()).totales[ESENCIALES], u(30), 'solo desaparece el anulado');
});

test('corregir funciona también pasada la ventana de deshacer', async () => {
  const { comandos, reloj } = await montar();
  const g = await comandos.registrarGasto({ bucket: ESENCIALES, categoryId: 'mercado', importeCents: u(80) });

  reloj.avanzarDias(3);
  assert.equal((await comandos.deshacer(g.movimiento.id)).motivo, 'FUERA_DE_PLAZO');

  const r = await comandos.editarMovimiento(g.movimiento.id, { importeCents: u(8) });
  assert.equal(r.ok, true, 'deshacer caduca, corregir no');
  assert.equal((await comandos.periodoActual()).totales[ESENCIALES], u(8));
});

test('un mes cerrado no se toca', async () => {
  const { comandos, reloj } = await montar('2026-09-10T09:00:00Z');
  const g = await comandos.registrarGasto({ bucket: ESENCIALES, categoryId: 'mercado', importeCents: u(40) });

  reloj.fijar('2026-10-02T09:00:00Z');
  await comandos.asegurarPeriodos();

  const anular = await comandos.anularMovimiento(g.movimiento.id);
  assert.equal(anular.ok, false);
  assert.equal(anular.codigo, 'MES_CERRADO');

  const editar = await comandos.editarMovimiento(g.movimiento.id, { importeCents: u(4) });
  assert.equal(editar.ok, false);
  assert.equal(editar.codigo, 'MES_CERRADO');

  const sep = await comandos.movimiento(g.movimiento.id);
  assert.equal(sep.editable, false);
  assert.equal(sep.movimiento.importeCents, u(40), 'el archivo queda intacto');
});

test('si la corrección choca con una regla, NO se pierde el original', async () => {
  const { comandos } = await montar();
  const g = await comandos.registrarGasto({ bucket: RESERVA, importeCents: u(30) });
  assert.equal(g.ok, true);

  // Historial para que exista mediana y R-17 pueda dispararse
  for (const n of [20, 25, 30, 22, 28]) {
    await comandos.registrarGasto({ bucket: ESENCIALES, categoryId: 'mercado', importeCents: u(n) });
  }

  const r = await comandos.editarMovimiento(g.movimiento.id, { importeCents: u(900_000) });
  assert.equal(r.ok, false);
  assert.equal(r.codigo, 'RECHAZADO');
  assert.equal(r.veredicto.ruleId, 'R-17');

  const sigue = await comandos.movimiento(g.movimiento.id);
  assert.ok(sigue, 'el movimiento original sigue existiendo');
  assert.equal(sigue.movimiento.importeCents, u(30), 'y con su importe de siempre');
  assert.equal((await comandos.periodoActual()).totales[RESERVA], u(30));

  // Y si de verdad era esa cifra, confirmando entra
  const confirmado = await comandos.editarMovimiento(g.movimiento.id, {
    importeCents: u(900_000), confirmado: true,
  });
  assert.equal(confirmado.ok, true);
});

test('movimiento() lo encuentra esté el mes abierto o cerrado', async () => {
  const { comandos, reloj } = await montar('2026-09-10T09:00:00Z');
  const viejo = await comandos.registrarGasto({ bucket: ESENCIALES, categoryId: 'mercado', importeCents: u(40) });

  reloj.fijar('2026-10-05T09:00:00Z');
  await comandos.asegurarPeriodos();
  const nuevo = await comandos.registrarGasto({ bucket: ESENCIALES, categoryId: 'mercado', importeCents: u(60) });

  assert.equal((await comandos.movimiento(viejo.movimiento.id)).editable, false);
  assert.equal((await comandos.movimiento(nuevo.movimiento.id)).editable, true);
  assert.equal(await comandos.movimiento('no-existe'), null);
});

test('corregir un ingreso rehace su reparto', async () => {
  const { comandos } = await montar();
  const antes = (await comandos.periodoActual()).techos;

  const ing = await comandos.registrarIngreso({ importeCents: u(40) });
  assert.equal(ing.reparto[INVERSION], u(20));

  const r = await comandos.editarMovimiento(ing.movimiento.id, { importeCents: u(80) });
  assert.equal(r.ok, true);

  const p = await comandos.periodoActual();
  assert.equal(p.techos[INVERSION], antes[INVERSION] + u(40), 'el techo refleja el importe corregido');
  assert.equal(p.ingresoTotal, u(1_000) + u(80));
});

// =========================================================================
// Copias de seguridad (UX-03)
// =========================================================================

test('una copia se analiza antes de tocar nada', async () => {
  const { comandos, repo } = await montar();
  await comandos.registrarGasto({ bucket: ESENCIALES, categoryId: 'mercado', importeCents: u(40) });

  const copia = await repo.exportar();
  const analisis = await comandos.analizarCopia(copia);

  assert.equal(analisis.valido, true);
  assert.equal(analisis.entrante.periodos, 1);
  assert.equal(analisis.entrante.primerMes, '2026-09');
  assert.ok(analisis.entrante.movimientos >= 2, 'el ingreso normal y el gasto');
  assert.ok(analisis.actual.movimientos >= 2, 'también cuenta lo que hay ahora');
});

test('un archivo que no es una copia se rechaza con motivo', async () => {
  const { comandos } = await montar();

  for (const basura of [null, 'texto', 42, [], { cualquiera: 1 }]) {
    const a = await comandos.analizarCopia(basura);
    assert.equal(a.valido, false, `${JSON.stringify(basura)} debería rechazarse`);
    assert.ok(a.motivo.length > 10, 'y decir por qué');
  }
});

test('a una copia incompleta se le nombra lo que falta', async () => {
  const { comandos } = await montar();
  const a = await comandos.analizarCopia({ periods: [], movements: [] });
  assert.equal(a.valido, false);
  assert.match(a.motivo, /settings/);
});

test('restaurar devuelve exactamente lo que había', async () => {
  const { comandos, repo } = await montar();
  await comandos.registrarGasto({ bucket: ESENCIALES, categoryId: 'mercado', importeCents: u(40) });
  await comandos.registrarGasto({ bucket: RECOMPENSAS, importeCents: u(20), destinoId: 'plan-hotel' });

  const copia = JSON.parse(JSON.stringify(await repo.exportar()));
  const antes = await comandos.periodoActual();

  // Desastre: se borra todo
  await repo.vaciar();
  await comandos.arrancar();
  assert.equal((await comandos.periodoActual()).totales[ESENCIALES], 0);

  const r = await comandos.restaurarCopia(copia);
  assert.equal(r.ok, true);

  const despues = await comandos.periodoActual();
  assert.equal(despues.totales[ESENCIALES], antes.totales[ESENCIALES]);
  assert.equal(despues.totales[RECOMPENSAS], antes.totales[RECOMPENSAS]);
  assert.deepEqual(despues.techos, antes.techos);
});

test('restaurar conserva el historial cerrado y los fondos', async () => {
  const { comandos, repo, reloj } = await montar('2026-09-01T09:00:00Z');
  reloj.fijar('2026-10-02T09:00:00Z');
  await comandos.asegurarPeriodos();

  const fondosAntes = await repo.fondos();
  const sobrantesAntes = await repo.sobrantes();
  assert.ok(fondosAntes[FONDO_AHORRO].saldoCents > 0);
  assert.equal(sobrantesAntes.length, 1);

  const copia = JSON.parse(JSON.stringify(await repo.exportar()));
  await repo.vaciar();
  await comandos.arrancar();
  await comandos.restaurarCopia(copia);

  const fondos = await repo.fondos();
  assert.equal(fondos[FONDO_AHORRO].saldoCents, fondosAntes[FONDO_AHORRO].saldoCents);
  assert.equal((await repo.sobrantes()).length, 1);
  assert.equal((await repo.periodosCerrados()).length, 1);
});

test('restaurar una copia inválida no destruye lo que hay', async () => {
  const { comandos } = await montar();
  await comandos.registrarGasto({ bucket: ESENCIALES, categoryId: 'mercado', importeCents: u(40) });

  const r = await comandos.restaurarCopia({ no: 'es una copia' });
  assert.equal(r.ok, false);
  assert.equal((await comandos.periodoActual()).totales[ESENCIALES], u(40), 'nada se tocó');
});

// =========================================================================
// Nota y fecha (UX-04, UX-05)
// =========================================================================

test('la nota libre llega al movimiento por el camino normal', async () => {
  const { comandos } = await montar();
  const r = await comandos.registrarGasto({
    bucket: ESENCIALES, categoryId: 'mercado', importeCents: u(40),
    nota: 'Compra grande del mes, con la carne del congelador',
  });
  assert.equal(r.ok, true);
  assert.match(r.movimiento.nota, /congelador/);
});

test('se puede registrar un gasto de un día anterior del mismo mes', async () => {
  const { comandos } = await montar('2026-09-14T09:00:00Z');

  const r = await comandos.registrarGasto({
    bucket: ESENCIALES, categoryId: 'mercado', importeCents: u(40), localDate: '2026-09-11',
  });
  assert.equal(r.ok, true);
  assert.equal(r.movimiento.localDate, '2026-09-11');
  assert.equal(r.movimiento.periodId, '2026-09', 'sigue contando en el mes en curso');
});

test('una fecha futura la sigue parando R-16', async () => {
  const { comandos } = await montar('2026-09-14T09:00:00Z');
  const r = await comandos.registrarGasto({
    bucket: ESENCIALES, categoryId: 'mercado', importeCents: u(40), localDate: '2026-09-20',
  });
  assert.equal(r.ok, false);
  assert.equal(r.veredicto.ruleId, 'R-16');
});
