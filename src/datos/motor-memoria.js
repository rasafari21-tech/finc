/**
 * Motor de almacenamiento en memoria, respaldado en localStorage.
 *
 * Existe por dos razones concretas:
 *   1. En file:// Chrome bloquea IndexedDB. El archivo de prueba lo necesita.
 *   2. Los tests del dominio corren en Node, donde no hay IndexedDB.
 *
 * Implementa la misma interfaz que motor-idb.js, de modo que repo.js escribe
 * las operaciones de negocio una sola vez. Es el diseño de puertos de AD-02
 * ganandose el sueldo.
 */

import { ALMACENES, NOMBRES } from './esquema.js';

const CLAVE_LS = 'finc:memoria';

function claveDe(almacen, registro, clavePasada) {
  const def = ALMACENES[almacen];
  if (clavePasada !== undefined) return clavePasada;
  if (def.keyPath) return registro[def.keyPath];
  return undefined;
}

/** Compara claves simples o compuestas, como hace IndexedDB. */
function comparaClaves(a, b) {
  const A = Array.isArray(a) ? a : [a];
  const B = Array.isArray(b) ? b : [b];
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const x = A[i];
    const y = B[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

function valorDeIndice(registro, keyPath) {
  if (Array.isArray(keyPath)) return keyPath.map((k) => registro[k]);
  return registro[keyPath];
}

export function crearMotorMemoria({ persistir = true } = {}) {
  /** @type {Map<string, Map<any, any>>} */
  const datos = new Map();
  const contadores = new Map();

  /** Cola de serializacion de transacciones. Ver `transaccion` mas abajo. */
  let cola = Promise.resolve();
  let enTransaccion = false;

  for (const nombre of NOMBRES) {
    datos.set(nombre, new Map());
    contadores.set(nombre, 0);
  }

  const hayLocalStorage = (() => {
    if (!persistir) return false;
    try {
      if (typeof localStorage === 'undefined') return false;
      localStorage.setItem('__prueba__', '1');
      localStorage.removeItem('__prueba__');
      return true;
    } catch {
      return false;
    }
  })();

  function volcar() {
    if (!hayLocalStorage) return;
    try {
      const plano = {};
      for (const [nombre, mapa] of datos) plano[nombre] = [...mapa.entries()];
      localStorage.setItem(CLAVE_LS, JSON.stringify({ datos: plano, contadores: [...contadores.entries()] }));
    } catch (e) {
      // Cuota agotada: seguimos en memoria. Es degradacion, no fallo.
      console.warn('No se pudo persistir en localStorage:', e?.name);
    }
  }

  function cargar() {
    if (!hayLocalStorage) return;
    try {
      const crudo = localStorage.getItem(CLAVE_LS);
      if (!crudo) return;
      const { datos: plano, contadores: c } = JSON.parse(crudo);
      for (const [nombre, entradas] of Object.entries(plano ?? {})) {
        if (datos.has(nombre)) datos.set(nombre, new Map(entradas));
      }
      for (const [nombre, valor] of c ?? []) contadores.set(nombre, valor);
    } catch (e) {
      console.warn('Almacen local ilegible, se empieza en limpio:', e?.message);
    }
  }

  const motor = {
    tipo: 'memoria',
    persistente: hayLocalStorage,

    async abrir() {
      cargar();
      return motor;
    },

    async cerrar() {},

    async obtener(almacen, clave) {
      return datos.get(almacen)?.get(JSON.stringify(clave)) ?? null;
    },

    async guardar(almacen, registro, clave) {
      const def = ALMACENES[almacen];
      let k = claveDe(almacen, registro, clave);
      if (def.autoIncrement && (k === undefined || k === null)) {
        k = contadores.get(almacen) + 1;
        contadores.set(almacen, k);
        registro = { ...registro, [def.keyPath]: k };
      }
      datos.get(almacen).set(JSON.stringify(k), registro);
      return k;
    },

    async borrar(almacen, clave) {
      datos.get(almacen).delete(JSON.stringify(clave));
    },

    async todos(almacen) {
      return [...datos.get(almacen).values()];
    },

    /**
     * Lee por indice con rango opcional [desde, hasta] sobre la clave del indice.
     * Devuelve ordenado por esa clave, como haria un cursor de IndexedDB.
     */
    async porIndice(almacen, indice, { desde, hasta, limite, descendente } = {}) {
      const def = ALMACENES[almacen].indices.find((i) => i.nombre === indice);
      if (!def) throw new Error(`INDICE_DESCONOCIDO: ${almacen}.${indice}`);

      let filas = [...datos.get(almacen).values()]
        .map((r) => ({ r, k: valorDeIndice(r, def.keyPath) }))
        .filter(({ k }) => {
          if (Array.isArray(k) && k.some((v) => v === undefined)) return false;
          if (k === undefined || k === null) return false;
          if (desde !== undefined && comparaClaves(k, desde) < 0) return false;
          if (hasta !== undefined && comparaClaves(k, hasta) > 0) return false;
          return true;
        })
        .sort((a, b) => comparaClaves(a.k, b.k));

      if (descendente) filas.reverse();
      if (limite) filas = filas.slice(0, limite);
      return filas.map(({ r }) => r);
    },

    async contar(almacen) {
      return datos.get(almacen).size;
    },

    /**
     * Transaccion: copia de seguridad, reversion y —lo importante— serializacion.
     *
     * La cola no es un adorno. IndexedDB serializa las transacciones que
     * comparten almacenes; sin equivalente aqui, dos cierres de mes lanzados a
     * la vez leen ambos `status: 'abierto'` antes de que ninguno escriba, pasan
     * los dos la guarda de idempotencia y el Fondo recibe el aporte por
     * duplicado. Los tests lo detectaron con cinco llamadas concurrentes.
     */
    async transaccion(almacenes, fn) {
      if (enTransaccion) return fn(motor); // reentrante: ya estamos dentro

      const anterior = cola;
      let liberar;
      cola = new Promise((r) => {
        liberar = r;
      });
      await anterior;

      const respaldo = new Map();
      for (const nombre of almacenes) respaldo.set(nombre, new Map(datos.get(nombre)));
      const contadoresPrevios = new Map(contadores);
      enTransaccion = true;

      try {
        const salida = await fn(motor);
        volcar();
        return salida;
      } catch (e) {
        for (const [nombre, mapa] of respaldo) datos.set(nombre, mapa);
        for (const [nombre, valor] of contadoresPrevios) contadores.set(nombre, valor);
        throw e;
      } finally {
        enTransaccion = false;
        liberar();
      }
    },

    async vaciar() {
      for (const nombre of NOMBRES) {
        datos.set(nombre, new Map());
        contadores.set(nombre, 0);
      }
      if (hayLocalStorage) {
        try {
          localStorage.removeItem(CLAVE_LS);
        } catch {
          /* nada que hacer */
        }
      }
    },

    /** Volcado completo, para exportar y para el inspector del panel de pruebas. */
    async exportar() {
      const salida = {};
      for (const [nombre, mapa] of datos) salida[nombre] = [...mapa.values()];
      return salida;
    },

    async importar(plano) {
      for (const [nombre, filas] of Object.entries(plano)) {
        if (!datos.has(nombre)) continue;
        const mapa = new Map();
        for (const fila of filas) {
          mapa.set(JSON.stringify(claveDe(nombre, fila)), fila);
        }
        datos.set(nombre, mapa);
      }
      volcar();
    },
  };

  return motor;
}
