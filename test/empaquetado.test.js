/**
 * Verifica que `prueba.html` no esta roto.
 *
 * El empaquetador reescribe imports y exports a mano; un fallo ahi produce un
 * archivo que abre en blanco y no dice por que. Este test ejecuta el bundle
 * generado dentro de un DOM simulado y comprueba que la app arranca, registra
 * un gasto y aplica las reglas — es decir, que lo que el usuario abre en el
 * navegador es de verdad la misma app.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

function elemento(nombre = 'div') {
  const el = {
    nombre,
    id: '',
    innerHTML: '',
    textContent: '',
    value: '',
    hidden: false,
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, contains: () => false },
    addEventListener() {},
    removeEventListener() {},
    appendChild() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    matches: () => false,
    getAttribute: () => null,
    setAttribute() {},
    click() {},
    focus() {},
  };
  return el;
}

function construirEntorno() {
  const documento = {
    getElementById: () => elemento(),
    createElement: (t) => elemento(t),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    head: elemento('head'),
    body: elemento('body'),
    hidden: false,
  };

  const ventana = {
    addEventListener() {},
    location: { protocol: 'file:', reload() {} },
  };

  const contexto = {
    window: ventana,
    document: documento,
    location: ventana.location,
    navigator: { storage: {}, vibrate() {} },
    crypto: globalThis.crypto,
    Intl: globalThis.Intl,
    console: { log() {}, warn() {}, error() {} },
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    queueMicrotask: globalThis.queueMicrotask,
    Promise,
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Error,
    Map,
    Set,
    Symbol,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    confirm: () => false,
    btoa: globalThis.btoa,
    atob: globalThis.atob,
  };
  contexto.globalThis = contexto;
  ventana.window = ventana;

  return { contexto, ventana };
}

function bundleDePrueba() {
  const ruta = join(RAIZ, 'prueba.html');
  if (!existsSync(ruta)) {
    execFileSync('python', [join(RAIZ, 'tools', 'empaquetar.py')], { cwd: RAIZ });
  }
  const html = readFileSync(ruta, 'utf-8');
  const m = html.match(/<script>\s*\(function \(\) \{([\s\S]*?)\}\)\(\);\s*<\/script>/);
  assert.ok(m, 'prueba.html no contiene el bundle esperado');
  return m[1];
}

async function esperar(condicion, ms = 4000) {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    const v = condicion();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error('La app no arrancó dentro del plazo');
}

test('prueba.html arranca y expone la app', async () => {
  const codigo = bundleDePrueba();
  const { contexto, ventana } = construirEntorno();
  vm.createContext(contexto);
  vm.runInContext(`(function(){'use strict';${codigo}})()`, contexto, { timeout: 10_000 });

  // Se espera a que la instantanea inicial este lista, no solo a que exista
  // `comandos`: arrancar() sigue corriendo despues de asignarlo, y actuar
  // durante ese hueco produce una carrera con la creacion del periodo.
  const auditor = await esperar(
    () => ventana.__auditor?.estado?.get?.().periodo && ventana.__auditor,
  );

  assert.ok(auditor.repo, 'el repositorio está disponible');
  assert.equal(auditor.repo.motor.tipo, 'memoria', 'sin IndexedDB cae al motor en memoria, como en file://');

  const periodo = await auditor.comandos.periodoActual();
  assert.match(periodo.id, /^\d{4}-\d{2}$/);
  assert.equal(periodo.status, 'abierto');
});

test('prueba.html reparte un ingreso informal igual que la app', async () => {
  const codigo = bundleDePrueba();
  const { contexto, ventana } = construirEntorno();
  vm.createContext(contexto);
  vm.runInContext(`(function(){'use strict';${codigo}})()`, contexto, { timeout: 10_000 });

  const auditor = await esperar(
    () => ventana.__auditor?.estado?.get?.().periodo && ventana.__auditor,
  );

  // Pequeno: mitad y mitad, en cantidades redondas y sin preguntar.
  const chico = await auditor.comandos.registrarIngreso({ importeCents: 2_000 });
  assert.equal(chico.ok, true);

  // El bundle corre en otro realm de V8, asi que sus objetos no comparten
  // Object.prototype con los de este archivo: deepStrictEqual fallaria por
  // identidad de prototipo aunque los valores coincidan. Se compara el JSON.
  assert.deepEqual(JSON.parse(JSON.stringify(chico.reparto)), {
    ESENCIALES: 0,
    INVERSION: 1_000,
    RESERVA: 1_000,
    RECOMPENSAS: 0,
  });

  // Grande: pregunta antes de escribir nada.
  const grande = await auditor.comandos.registrarIngreso({ importeCents: 7_000 });
  assert.equal(grande.ok, false);
  assert.equal(grande.requierePreguntar, true);
  assert.equal(grande.opciones.length, 3);
});

test('prueba.html aplica las reglas inflexibles', async () => {
  const codigo = bundleDePrueba();
  const { contexto, ventana } = construirEntorno();
  vm.createContext(contexto);
  vm.runInContext(`(function(){'use strict';${codigo}})()`, contexto, { timeout: 10_000 });

  // Se espera a que la instantanea inicial este lista, no solo a que exista
  // `comandos`: arrancar() sigue corriendo despues de asignarlo, y actuar
  // durante ese hueco produce una carrera con la creacion del periodo.
  const auditor = await esperar(
    () => ventana.__auditor?.estado?.get?.().periodo && ventana.__auditor,
  );
  await auditor.comandos.registrarIngreso({ importeCents: 1_000_000, categoryId: 'nomina' });

  const regalo = await auditor.comandos.registrarGasto({
    bucket: 'ESENCIALES',
    categoryId: 'regalo',
    importeCents: 10_000,
  });
  assert.equal(regalo.ok, false);
  assert.equal(regalo.veredicto.ruleId, 'R-01');
  assert.equal(regalo.sugerencia.bucket, 'RECOMPENSAS');

  // Reserva tiene un unico destino (Cachinha) y se asigna solo, asi que R-08
  // ya no bloquea: el destino declarado ES el rastro que la regla exigia.
  const reserva = await auditor.comandos.registrarGasto({
    bucket: 'RESERVA',
    importeCents: 10_000,
  });
  assert.equal(reserva.ok, true);
  assert.equal(reserva.movimiento.destinoId, 'cachinha');

  // Inversion sí tiene que elegirse
  const inversion = await auditor.comandos.registrarGasto({
    bucket: 'INVERSION',
    importeCents: 10_000,
  });
  assert.equal(inversion.ok, false);
  assert.equal(inversion.faltaDestino, 'DESTINO_DESCONOCIDO');

  const normal = await auditor.comandos.registrarGasto({
    bucket: 'ESENCIALES',
    categoryId: 'mercado',
    importeCents: 10_000,
  });
  assert.equal(normal.ok, true);
});

test('el bundle incluye todos los módulos del dominio', () => {
  const codigo = bundleDePrueba();
  const necesarios = [
    'src/dominio/reparto.js',
    'src/dominio/reglas.js',
    'src/dominio/clasificador.js',
    'src/dominio/cierre.js',
    'src/dominio/carry.js',
    'src/dominio/diagnostico.js',
    'src/dominio/redondeo.js',
    'src/dominio/informales.js',
    'src/dominio/destinos.js',
    'src/dominio/sobrante.js',
    'src/datos/repo.js',
    'src/app/comandos.js',
    'tools/panel-pruebas.js',
  ];
  for (const m of necesarios) {
    assert.ok(codigo.includes(`__m['${m}']`), `falta ${m} en el bundle`);
  }
});

test('no quedan sentencias import o export sin transformar', () => {
  const codigo = bundleDePrueba();
  assert.equal(/^\s*import\s+[{'"]/m.test(codigo), false, 'quedó un import sin transformar');
  assert.equal(/^\s*export\s+/m.test(codigo), false, 'quedó un export sin transformar');
});
