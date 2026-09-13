/**
 * Motor de almacenamiento sobre IndexedDB.
 *
 * Misma interfaz que motor-memoria.js. Sin envoltorios de terceros: IndexedDB
 * en crudo es verboso pero no dificil, y aqui ahorra una dependencia completa.
 */

import { NOMBRE_BD, VERSION_ESQUEMA, ALMACENES, NOMBRES } from './esquema.js';

function promesa(peticion) {
  return new Promise((resolver, rechazar) => {
    peticion.onsuccess = () => resolver(peticion.result);
    peticion.onerror = () => rechazar(peticion.error);
  });
}

function finDeTransaccion(tx) {
  return new Promise((resolver, rechazar) => {
    tx.oncomplete = () => resolver();
    tx.onerror = () => rechazar(tx.error);
    tx.onabort = () => rechazar(tx.error ?? new Error('TRANSACCION_ABORTADA'));
  });
}

export function hayIndexedDB() {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

export function crearMotorIDB() {
  /** @type {IDBDatabase|null} */
  let bd = null;
  /** @type {IDBTransaction|null} Transaccion activa, si estamos dentro de una. */
  let txActiva = null;

  function almacenDe(nombre, modo = 'readonly') {
    if (txActiva) return txActiva.objectStore(nombre);
    const tx = bd.transaction(nombre, modo);
    return tx.objectStore(nombre);
  }

  const motor = {
    tipo: 'indexeddb',
    persistente: true,

    async abrir() {
      bd = await new Promise((resolver, rechazar) => {
        const peticion = indexedDB.open(NOMBRE_BD, VERSION_ESQUEMA);

        peticion.onupgradeneeded = (evento) => {
          const db = peticion.result;
          const desde = evento.oldVersion;

          // Migraciones solo hacia delante y nunca destructivas (§5).
          const crear = (nombre) => {
            if (db.objectStoreNames.contains(nombre)) return;
            const def = ALMACENES[nombre];
            const almacen = db.createObjectStore(nombre, {
              keyPath: def.keyPath,
              autoIncrement: Boolean(def.autoIncrement),
            });
            for (const idx of def.indices ?? []) {
              almacen.createIndex(idx.nombre, idx.keyPath, { unique: Boolean(idx.unico) });
            }
          };

          if (desde < 1) {
            for (const nombre of Object.keys(ALMACENES)) crear(nombre);
          }

          // v2 · historial de sobrantes mensuales. Aditiva: no toca nada previo.
          if (desde < 2) {
            crear('sobrantes');
          }

          // Las versiones futuras añaden sus bloques aqui, sin tocar los previos.
        };

        peticion.onsuccess = () => resolver(peticion.result);
        peticion.onerror = () => rechazar(peticion.error);
        peticion.onblocked = () => rechazar(new Error('BD_BLOQUEADA_POR_OTRA_PESTAÑA'));
      });

      // Pide al navegador que no desaloje el almacen por inactividad (§16).
      try {
        if (navigator.storage?.persist) await navigator.storage.persist();
      } catch {
        /* no es critico */
      }

      return motor;
    },

    async cerrar() {
      bd?.close();
      bd = null;
    },

    async obtener(almacen, clave) {
      return (await promesa(almacenDe(almacen).get(clave))) ?? null;
    },

    async guardar(almacen, registro, clave) {
      const def = ALMACENES[almacen];
      const st = almacenDe(almacen, 'readwrite');
      if (def.autoIncrement && registro[def.keyPath] === undefined) {
        return promesa(st.add(registro));
      }
      return promesa(clave === undefined ? st.put(registro) : st.put(registro, clave));
    },

    async borrar(almacen, clave) {
      return promesa(almacenDe(almacen, 'readwrite').delete(clave));
    },

    async todos(almacen) {
      return promesa(almacenDe(almacen).getAll());
    },

    async porIndice(almacen, indice, { desde, hasta, limite, descendente } = {}) {
      const idx = almacenDe(almacen).index(indice);
      let rango = null;
      if (desde !== undefined && hasta !== undefined) rango = IDBKeyRange.bound(desde, hasta);
      else if (desde !== undefined) rango = IDBKeyRange.lowerBound(desde);
      else if (hasta !== undefined) rango = IDBKeyRange.upperBound(hasta);

      if (!descendente) {
        return promesa(limite ? idx.getAll(rango, limite) : idx.getAll(rango));
      }

      // Descendente exige cursor: getAll no admite direccion.
      return new Promise((resolver, rechazar) => {
        const salida = [];
        const peticion = idx.openCursor(rango, 'prev');
        peticion.onsuccess = () => {
          const cursor = peticion.result;
          if (!cursor || (limite && salida.length >= limite)) return resolver(salida);
          salida.push(cursor.value);
          cursor.continue();
        };
        peticion.onerror = () => rechazar(peticion.error);
      });
    },

    async contar(almacen) {
      return promesa(almacenDe(almacen).count());
    },

    /**
     * Transaccion real de IndexedDB. Todas las escrituras del callback caen
     * dentro de ella, asi que un fallo a mitad no deja un movimiento huerfano
     * ni un total desincronizado (§2).
     */
    async transaccion(almacenes, fn) {
      if (txActiva) return fn(motor); // ya estamos dentro de una

      const tx = bd.transaction(almacenes, 'readwrite');
      txActiva = tx;
      try {
        const salida = await fn(motor);
        await finDeTransaccion(tx);
        return salida;
      } catch (e) {
        try {
          tx.abort();
        } catch {
          /* ya abortada */
        }
        throw e;
      } finally {
        txActiva = null;
      }
    },

    async vaciar() {
      const tx = bd.transaction(NOMBRES, 'readwrite');
      for (const nombre of NOMBRES) tx.objectStore(nombre).clear();
      await finDeTransaccion(tx);
    },

    async exportar() {
      const salida = {};
      for (const nombre of NOMBRES) salida[nombre] = await motor.todos(nombre);
      return salida;
    },

    async importar(plano) {
      await motor.transaccion(NOMBRES, async () => {
        for (const [nombre, filas] of Object.entries(plano)) {
          if (!NOMBRES.includes(nombre)) continue;
          for (const fila of filas) await motor.guardar(nombre, fila);
        }
      });
    },
  };

  return motor;
}

/**
 * Elige el motor disponible. IndexedDB si lo hay; memoria en caso contrario,
 * que es lo que ocurre al abrir el archivo de prueba desde file://.
 */
export async function crearMotor({ forzar } = {}) {
  if (forzar === 'memoria' || !hayIndexedDB()) {
    const { crearMotorMemoria } = await import('./motor-memoria.js');
    return crearMotorMemoria().abrir();
  }
  try {
    return await crearMotorIDB().abrir();
  } catch (e) {
    console.warn('IndexedDB no disponible, se usa memoria:', e?.message);
    const { crearMotorMemoria } = await import('./motor-memoria.js');
    return crearMotorMemoria().abrir();
  }
}
