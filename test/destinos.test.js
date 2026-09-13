/**
 * Destinos por techo (§2, §3, §4) y su efecto sobre la regla R-08.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DESTINOS_POR_DEFECTO, destinosDe, tieneDestinos, destinoAutomatico,
  buscarDestino, categoriaDe, validarDestino, etiquetaDestino,
} from '../src/dominio/destinos.js';
import { ajustesPorDefecto } from '../src/datos/esquema.js';
import { evaluarMovimiento } from '../src/dominio/clasificador.js';
import { ESENCIALES, INVERSION, RESERVA, RECOMPENSAS } from '../src/dominio/buckets.js';

const ajustes = ajustesPorDefecto('UTC');

test('los destinos de los ajustes y los del dominio coinciden', () => {
  // Estan duplicados a proposito (datos no importa dominio), asi que este test
  // es el que impide que se separen sin que nadie se entere.
  assert.deepEqual(ajustes.destinos, DESTINOS_POR_DEFECTO);
});

test('Inversión ofrece Cachinha y «otro», sin pedir justificación', () => {
  const lista = destinosDe(ajustes, INVERSION);
  assert.deepEqual(lista.map((d) => d.nombre), ['Cachinha de Nubank', 'Otro tipo de inversión']);
  assert.equal(lista[0].pideTexto, false, 'Cachinha se registra directo');
  assert.equal(lista[1].pideTexto, true, '«otro» pide especificar');
  assert.equal(lista[1].etiquetaTexto, 'Especifica');
});

test('Reserva tiene un único destino y se asigna sola', () => {
  const auto = destinoAutomatico(ajustes, RESERVA);
  assert.ok(auto, 'no hay nada que preguntar');
  assert.equal(auto.id, 'cachinha');
  assert.equal(destinosDe(ajustes, RESERVA).length, 1);
});

test('Recompensa ofrece plan de hotel y «otro»', () => {
  const lista = destinosDe(ajustes, RECOMPENSAS);
  assert.deepEqual(lista.map((d) => d.nombre), ['Plan de hotel', 'Otro']);
  assert.equal(lista[1].pideTexto, true);
});

test('Esenciales no lleva destinos: mantiene categorías y nota libre', () => {
  assert.equal(tieneDestinos(ajustes, ESENCIALES), false);
  assert.equal(destinoAutomatico(ajustes, ESENCIALES), null);
});

test('Inversión y Recompensa NO se asignan solas: hay que elegir', () => {
  assert.equal(destinoAutomatico(ajustes, INVERSION), null);
  assert.equal(destinoAutomatico(ajustes, RECOMPENSAS), null);
});

test('validación · «otro» sin texto no pasa', () => {
  const sinTexto = validarDestino(ajustes, INVERSION, 'otro-inversion', '');
  assert.equal(sinTexto.ok, false);
  assert.equal(sinTexto.codigo, 'FALTA_ESPECIFICAR');
  assert.equal(sinTexto.etiqueta, 'Especifica');

  const conTexto = validarDestino(ajustes, INVERSION, 'otro-inversion', 'Tesouro Selic');
  assert.equal(conTexto.ok, true);
});

test('validación · Cachinha pasa sin texto', () => {
  assert.equal(validarDestino(ajustes, INVERSION, 'cachinha').ok, true);
  assert.equal(validarDestino(ajustes, RESERVA, 'cachinha').ok, true);
});

test('validación · un destino que no existe se rechaza', () => {
  assert.equal(validarDestino(ajustes, INVERSION, 'inventado').codigo, 'DESTINO_DESCONOCIDO');
});

test('validación · Esenciales acepta cualquier cosa porque no usa destinos', () => {
  assert.equal(validarDestino(ajustes, ESENCIALES, null, '').ok, true);
});

test('cada destino arrastra una categoría, para que el historial siga agrupando', () => {
  assert.equal(categoriaDe('cachinha', INVERSION), 'indexado');
  assert.equal(categoriaDe('cachinha', RESERVA), 'emergencia');
  assert.equal(categoriaDe('plan-hotel', RECOMPENSAS), 'viaje');
  assert.equal(categoriaDe('inventado', INVERSION), null);
});

test('la etiqueta del historial es el texto escrito, si lo hay', () => {
  assert.equal(
    etiquetaDestino({ bucket: INVERSION, destinoId: 'cachinha' }, ajustes),
    'Cachinha de Nubank',
  );
  assert.equal(
    etiquetaDestino({ bucket: INVERSION, destinoId: 'otro-inversion', destinoTexto: 'Tesouro Selic' }, ajustes),
    'Tesouro Selic',
  );
  assert.equal(etiquetaDestino({ bucket: ESENCIALES }, ajustes), null);
});

test('buscarDestino encuentra por id', () => {
  assert.equal(buscarDestino(ajustes, RECOMPENSAS, 'plan-hotel').nombre, 'Plan de hotel');
  assert.equal(buscarDestino(ajustes, RECOMPENSAS, 'nada'), null);
});

// --- R-08 con destinos ----------------------------------------------------

const CTX = {
  periodo: { id: '2026-09', techos: { RESERVA: 100_000_00 }, totales: {} },
  fechaHoy: '2026-09-15',
  medianaImporte: 0,
  periodosCerrados: [],
  movimientosRecientes: [],
};

function mov(extra) {
  return {
    id: 'm', tipo: 'gasto', bucket: RESERVA, categoryId: 'emergencia',
    importeCents: 5_000_00, localDate: '2026-09-15', periodId: '2026-09',
    ts: Date.now(), tags: [], nota: '', ...extra,
  };
}

test('R-08 · mover Reserva con destino declarado ya no pide justificación', () => {
  const v = evaluarMovimiento(mov({ destinoId: 'cachinha' }), CTX);
  assert.equal(v.tipo, 'OK', 'la Cachinha dice a dónde fue el dinero mejor que un código');
});

test('R-08 · sin destino ni motivo sigue bloqueando', () => {
  const v = evaluarMovimiento(mov({}), CTX);
  assert.equal(v.tipo, 'DENY');
  assert.equal(v.ruleId, 'R-08');
});

test('R-08 · el código de retirada sigue valiendo', () => {
  const v = evaluarMovimiento(mov({ razonReserva: 'SALUD' }), CTX);
  assert.equal(v.tipo, 'OK');
});
