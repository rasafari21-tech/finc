import test from 'node:test';
import assert from 'node:assert/strict';

import { repartir, aplicarCascada, repartirIngreso } from '../src/dominio/reparto.js';
import { ORDEN, PESOS_POR_DEFECTO, ceros, FONDO_AHORRO, ESENCIALES, INVERSION, RESERVA, RECOMPENSAS, validarPesos, validarCascada } from '../src/dominio/buckets.js';
import { parsearCentavos, formatear } from '../src/dominio/dinero.js';

const suma = (o) => ORDEN.reduce((a, b) => a + o[b], 0);

test('reparto · caso trazado de la especificacion §6.2', () => {
  const r = repartir(333333, PESOS_POR_DEFECTO);
  assert.equal(r.ESENCIALES, 166667, 'Esenciales recibe el centavo de la fraccion 0,50');
  assert.equal(r.INVERSION, 83333);
  assert.equal(r.RESERVA, 50000, 'Reserva recibe el primer centavo: fraccion 0,95');
  assert.equal(r.RECOMPENSAS, 33333);
  assert.equal(suma(r), 333333);
});

test('reparto · importe redondo sin resto', () => {
  const r = repartir(100000, PESOS_POR_DEFECTO);
  assert.deepEqual(r, { ESENCIALES: 50000, INVERSION: 25000, RESERVA: 15000, RECOMPENSAS: 10000 });
});

test('reparto · invariante: la suma es SIEMPRE el importe', () => {
  for (let i = 0; i < 20000; i++) {
    const importe = 1 + Math.floor(Math.random() * 50_000_000);
    assert.equal(suma(repartir(importe, PESOS_POR_DEFECTO)), importe, `falla con ${importe}`);
  }
});

test('reparto · invariante con pesos arbitrarios que sumen 100 %', () => {
  const juegos = [
    { ESENCIALES: 6200, INVERSION: 1800, RESERVA: 1500, RECOMPENSAS: 500 },
    { ESENCIALES: 3333, INVERSION: 3333, RESERVA: 3333, RECOMPENSAS: 1 },
    { ESENCIALES: 10000, INVERSION: 0, RESERVA: 0, RECOMPENSAS: 0 },
    { ESENCIALES: 2500, INVERSION: 2500, RESERVA: 2500, RECOMPENSAS: 2500 },
  ];
  for (const pesos of juegos) {
    for (let i = 0; i < 2000; i++) {
      const importe = 1 + Math.floor(Math.random() * 9_999_999);
      assert.equal(suma(repartir(importe, pesos)), importe);
    }
  }
});

test('reparto · es determinista: mismo importe, mismo resultado', () => {
  const a = repartir(777777, PESOS_POR_DEFECTO);
  for (let i = 0; i < 50; i++) {
    assert.deepEqual(repartir(777777, PESOS_POR_DEFECTO), a);
  }
});

test('reparto · un centavo va entero al primero del orden canonico', () => {
  const r = repartir(1, PESOS_POR_DEFECTO);
  assert.equal(suma(r), 1);
  assert.equal(r.ESENCIALES, 1, 'desempate por ORDEN: Esenciales primero');
});

test('reparto · rechaza importes y pesos invalidos', () => {
  assert.throws(() => repartir(0, PESOS_POR_DEFECTO), /IMPORTE_INVALIDO/);
  assert.throws(() => repartir(-100, PESOS_POR_DEFECTO), /IMPORTE_INVALIDO/);
  assert.throws(() => repartir(1.5, PESOS_POR_DEFECTO), /IMPORTE_INVALIDO/);
  assert.throws(
    () => repartir(1000, { ESENCIALES: 5000, INVERSION: 2500, RESERVA: 1500, RECOMPENSAS: 900 }),
    /NO_SUMAN_100/,
  );
});

test('cascada · sin topes absolutos es la identidad', () => {
  const bruto = repartir(1_000_000, PESOS_POR_DEFECTO);
  const { asignado, aFondo } = aplicarCascada(bruto, ceros(), {}, {});
  assert.deepEqual(asignado, bruto);
  assert.equal(aFondo, 0);
});

test('cascada · el excedente de Recompensas cae en Reserva', () => {
  const bruto = { ESENCIALES: 0, INVERSION: 0, RESERVA: 0, RECOMPENSAS: 100_000 };
  const topes = { RECOMPENSAS: 30_000 };
  const cascada = { RECOMPENSAS: RESERVA };
  const { asignado, aFondo } = aplicarCascada(bruto, ceros(), topes, cascada);

  assert.equal(asignado.RECOMPENSAS, 30_000);
  assert.equal(asignado.RESERVA, 70_000, 'los 70.000 sobrantes bajan a Reserva');
  assert.equal(aFondo, 0);
});

test('cascada · encadena hasta el Fondo cuando todo esta topado', () => {
  const bruto = { ESENCIALES: 0, INVERSION: 0, RESERVA: 0, RECOMPENSAS: 100_000 };
  const topes = { RECOMPENSAS: 30_000, RESERVA: 10_000 };
  const cascada = { RECOMPENSAS: RESERVA, RESERVA: FONDO_AHORRO };
  const { asignado, aFondo } = aplicarCascada(bruto, ceros(), topes, cascada);

  assert.equal(asignado.RECOMPENSAS, 30_000);
  assert.equal(asignado.RESERVA, 10_000);
  assert.equal(aFondo, 60_000, 'el resto termina en el Fondo, que es el destino terminal');
});

test('cascada · respeta lo ya ocupado del techo', () => {
  const techosActuales = { ...ceros(), RECOMPENSAS: 25_000 };
  const bruto = { ESENCIALES: 0, INVERSION: 0, RESERVA: 0, RECOMPENSAS: 20_000 };
  const { asignado } = aplicarCascada(bruto, techosActuales, { RECOMPENSAS: 30_000 }, { RECOMPENSAS: RESERVA });

  assert.equal(asignado.RECOMPENSAS, 5_000, 'solo caben 5.000 mas');
  assert.equal(asignado.RESERVA, 15_000);
});

test('cascada · techo ya lleno derrama el importe completo', () => {
  const techosActuales = { ...ceros(), RECOMPENSAS: 40_000 };
  const bruto = { ESENCIALES: 0, INVERSION: 0, RESERVA: 0, RECOMPENSAS: 20_000 };
  const { asignado } = aplicarCascada(bruto, techosActuales, { RECOMPENSAS: 30_000 }, { RECOMPENSAS: RESERVA });

  assert.equal(asignado.RECOMPENSAS, 0);
  assert.equal(asignado.RESERVA, 20_000);
});

test('repartirIngreso · nada se pierde ni se inventa, con o sin topes', () => {
  for (let i = 0; i < 3000; i++) {
    const importe = 1 + Math.floor(Math.random() * 5_000_000);
    const { asignado, aFondo } = repartirIngreso(importe, {
      pesos: PESOS_POR_DEFECTO,
      techosActuales: ceros(),
      topes: { ESENCIALES: 200_000, RECOMPENSAS: 50_000 },
      cascada: { ESENCIALES: RESERVA, RECOMPENSAS: RESERVA, RESERVA: FONDO_AHORRO },
    });
    assert.equal(suma(asignado) + aFondo, importe);
  }
});

test('validarCascada · detecta ciclos', () => {
  assert.equal(validarCascada({ ESENCIALES: RESERVA, RESERVA: ESENCIALES }).ok, false);
  assert.equal(validarCascada({ ESENCIALES: RESERVA, RESERVA: FONDO_AHORRO }).ok, true);
});

test('validarPesos · exige suma exacta de 10.000 puntos basicos', () => {
  assert.equal(validarPesos(PESOS_POR_DEFECTO).ok, true);
  assert.equal(validarPesos({ ESENCIALES: 5000, INVERSION: 2500, RESERVA: 1500, RECOMPENSAS: 1001 }).ok, false);
  assert.equal(validarPesos({ ESENCIALES: -1, INVERSION: 2501, RESERVA: 1500, RECOMPENSAS: 6000 }).ok, false);
});

test('dinero · parseo de lo que teclea una persona', () => {
  assert.equal(parsearCentavos('1234'), 123400);
  assert.equal(parsearCentavos('1.234,56'), 123456);
  assert.equal(parsearCentavos('1234.56'), 123456);
  assert.equal(parsearCentavos('1 234,5'), 123450);
  assert.equal(parsearCentavos('45000'), 4500000);
  assert.equal(parsearCentavos('0,01'), 1);
  assert.equal(parsearCentavos(''), null);
  assert.equal(parsearCentavos('abc'), null);
});

test('dinero · formato latinoamericano y decimales solo cuando importan', () => {
  assert.equal(formatear(123400), 'R$1.234');
  assert.equal(formatear(123456), 'R$1.234,56');
  assert.equal(formatear(-5000), '-R$50');
  assert.equal(formatear(166667), 'R$1.666,67');
  assert.equal(formatear(123400, { decimales: 'siempre' }), 'R$1.234,00');
});

test('dinero · el parseo y el formato son inversos', () => {
  for (let i = 0; i < 5000; i++) {
    const centavos = 1 + Math.floor(Math.random() * 100_000_000);
    const texto = formatear(centavos, { decimales: 'siempre' }).replace('R$', '');
    assert.equal(parsearCentavos(texto), centavos);
  }
});
