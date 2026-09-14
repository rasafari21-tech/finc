/**
 * Repositorio: operaciones de negocio sobre el motor de almacenamiento.
 *
 * Escritas una sola vez contra la interfaz del motor, de modo que funcionan
 * igual sobre IndexedDB y sobre memoria. Cada operacion que toca varios
 * almacenes lo hace dentro de una transaccion: si algo falla, no queda un
 * movimiento huerfano ni un total desincronizado (§2).
 */

import { ajustesPorDefecto, nuevoId, nuevoDeviceId, nuevaRev } from './esquema.js';
import { FONDO_AHORRO, CARTERA_INVERSION } from '../dominio/buckets.js';

export function crearRepo(motor, boveda) {
  const sellar = (almacen, r) => boveda.sellar(almacen, r);
  const abrir = (almacen, r) => boveda.abrirRegistro(almacen, r);
  const abrirVarios = (almacen, rs) => boveda.abrirVarios(almacen, rs);

  let deviceIdCache = null;

  const repo = {
    motor,
    boveda,

    // --- ajustes ----------------------------------------------------------

    async ajustes() {
      const crudo = await motor.obtener('settings', 'ajustes');
      if (!crudo) return null;
      return abrir('settings', crudo);
    },

    async guardarAjustes(a) {
      await motor.guardar('settings', await sellar('settings', { ...a, key: 'ajustes' }));
      return a;
    },

    async ajuste(key) {
      const crudo = await motor.obtener('settings', key);
      return crudo ? abrir('settings', crudo) : null;
    },

    async guardarAjuste(key, valor) {
      await motor.guardar('settings', await sellar('settings', { ...valor, key }));
    },

    /** La configuracion de la boveda va SIN cifrar: es lo que permite abrirla. */
    async configBoveda() {
      return motor.obtener('settings', 'boveda');
    },

    async guardarConfigBoveda(config) {
      await motor.guardar('settings', { key: 'boveda', ...config });
    },

    async deviceId() {
      if (deviceIdCache) return deviceIdCache;
      const guardado = await motor.obtener('settings', 'device');
      if (guardado?.deviceId) {
        deviceIdCache = guardado.deviceId;
        return deviceIdCache;
      }
      deviceIdCache = nuevoDeviceId();
      await motor.guardar('settings', { key: 'device', deviceId: deviceIdCache });
      return deviceIdCache;
    },

    /** Inicializa el almacen si esta vacio. Idempotente. */
    async inicializar(zona) {
      const existentes = await repo.ajustes();
      if (existentes) return existentes;
      const a = ajustesPorDefecto(zona);
      await repo.guardarAjustes(a);
      await repo.guardarFondo({ id: FONDO_AHORRO, saldoCents: 0, actualizadoEn: Date.now() });
      await repo.guardarFondo({ id: CARTERA_INVERSION, saldoCents: 0, actualizadoEn: Date.now() });
      await repo.deviceId();
      return a;
    },

    // --- periodos ---------------------------------------------------------

    async periodo(id) {
      const crudo = await motor.obtener('periods', id);
      return crudo ? abrir('periods', crudo) : null;
    },

    async guardarPeriodo(p) {
      await motor.guardar('periods', await sellar('periods', p));
      return p;
    },

    async periodos() {
      const crudos = await motor.todos('periods');
      const abiertos = await abrirVarios('periods', crudos);
      return abiertos.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    },

    async periodosCerrados() {
      return (await repo.periodos()).filter((p) => p.status === 'cerrado');
    },

    async ultimoCerrado() {
      const cerrados = await repo.periodosCerrados();
      return cerrados.length ? cerrados[cerrados.length - 1].id : null;
    },

    async periodoAbierto() {
      const todos = await repo.periodos();
      return todos.find((p) => p.status === 'abierto') ?? null;
    },

    async primerPeriodo() {
      const todos = await repo.periodos();
      return todos.length ? todos[0].id : null;
    },

    // --- movimientos ------------------------------------------------------

    async movimientos({ periodId, bucket, limite, descendente = true } = {}) {
      let crudos;
      if (periodId && bucket) {
        crudos = await motor.porIndice('movements', 'periodId_bucket', {
          desde: [periodId, bucket],
          hasta: [periodId, bucket],
        });
      } else if (periodId) {
        crudos = await motor.porIndice('movements', 'periodId_ts', {
          desde: [periodId, 0],
          hasta: [periodId, Number.MAX_SAFE_INTEGER],
          descendente,
          limite,
        });
      } else {
        crudos = await motor.porIndice('movements', 'ts', { descendente, limite });
      }
      const abiertos = await abrirVarios('movements', crudos);
      if (periodId && bucket) {
        abiertos.sort((a, b) => (descendente ? b.ts - a.ts : a.ts - b.ts));
        return limite ? abiertos.slice(0, limite) : abiertos;
      }
      return abiertos;
    },

    async movimientosDesde(ts) {
      const crudos = await motor.porIndice('movements', 'ts', { desde: ts });
      return abrirVarios('movements', crudos);
    },

    async asignaciones(periodId) {
      const crudos = await motor.porIndice('allocations', 'periodId', { desde: periodId, hasta: periodId });
      return abrirVarios('allocations', crudos);
    },

    // --- fondos -----------------------------------------------------------

    async fondos() {
      const crudos = await motor.todos('funds');
      const abiertos = await abrirVarios('funds', crudos);
      const salida = {};
      for (const f of abiertos) salida[f.id] = f;
      return salida;
    },

    async guardarFondo(f) {
      await motor.guardar('funds', await sellar('funds', f));
    },

    async entradasFondo(fundId, limite = 50) {
      const crudos = await motor.porIndice('fundEntries', 'fundId_ts', {
        desde: [fundId, 0],
        hasta: [fundId, Number.MAX_SAFE_INTEGER],
        descendente: true,
        limite,
      });
      return abrirVarios('fundEntries', crudos);
    },

    // --- bitacora ---------------------------------------------------------

    async agregarEvento(evento) {
      await motor.guardar('auditLog', await sellar('auditLog', { ts: Date.now(), ...evento }));
    },

    async eventos({ periodId, limite = 200 } = {}) {
      const crudos = periodId
        ? await motor.porIndice('auditLog', 'periodId', { desde: periodId, hasta: periodId })
        : await motor.porIndice('auditLog', 'ts', { descendente: true, limite });
      return abrirVarios('auditLog', crudos);
    },

    // --- anclas e informes ------------------------------------------------

    async ancla(periodId) {
      const crudo = await motor.obtener('anchors', periodId);
      return crudo ? abrir('anchors', crudo) : null;
    },

    async guardarAncla(a) {
      await motor.guardar('anchors', await sellar('anchors', a));
    },

    async anclas() {
      const crudos = await motor.todos('anchors');
      const abiertas = await abrirVarios('anchors', crudos);
      return abiertas.sort((a, b) => (a.periodId < b.periodId ? -1 : 1));
    },

    // --- sobrantes mensuales (§12, §13) ----------------------------------

    async sobrante(periodId) {
      const crudo = await motor.obtener('sobrantes', periodId);
      return crudo ? abrir('sobrantes', crudo) : null;
    },

    async guardarSobrante(registro) {
      await motor.guardar('sobrantes', await sellar('sobrantes', registro));
      return registro;
    },

    /** Historial completo, del mes mas reciente al mas antiguo. */
    async sobrantes() {
      const crudos = await motor.todos('sobrantes');
      const abiertos = await abrirVarios('sobrantes', crudos);
      return abiertos.sort((a, b) => (a.periodId > b.periodId ? -1 : a.periodId < b.periodId ? 1 : 0));
    },

    async informe(periodId) {
      const crudo = await motor.obtener('archives', periodId);
      if (!crudo) return null;
      const a = await abrir('archives', crudo);
      return a.informe ?? null;
    },

    /** El registro completo de archives, no solo su informe. */
    async archivo(periodId) {
      const crudo = await motor.obtener('archives', periodId);
      return crudo ? abrir('archives', crudo) : null;
    },

    async guardarArchivo(registro) {
      await motor.guardar('archives', await sellar('archives', registro));
      return registro;
    },

    async informes() {
      const crudos = await motor.todos('archives');
      const abiertos = await abrirVarios('archives', crudos);
      return abiertos.sort((a, b) => (a.periodId > b.periodId ? -1 : 1));
    },

    // --- escrituras atomicas ---------------------------------------------

    /**
     * Escribe un movimiento con sus asignaciones y actualiza los totales
     * materializados del periodo, todo en una sola transaccion (AD-05).
     */
    async escribirMovimiento({ mov, asignaciones = [], periodo, evento = null, entradasFondo = [] }) {
      const deviceId = await repo.deviceId();
      const rev = nuevaRev(deviceId);
      const completo = { ...mov, deviceId, rev, syncState: 'local' };

      await motor.transaccion(['movements', 'allocations', 'periods', 'auditLog', 'funds', 'fundEntries'], async () => {
        await motor.guardar('movements', await sellar('movements', completo));

        for (const a of asignaciones) {
          await motor.guardar(
            'allocations',
            await sellar('allocations', { id: a.id ?? nuevoId(), periodId: periodo.id, ...a }),
          );
        }

        await motor.guardar('periods', await sellar('periods', periodo));

        for (const e of entradasFondo) {
          await repo.aplicarEntradaFondo(e);
        }

        if (evento) {
          await motor.guardar('auditLog', await sellar('auditLog', { ts: Date.now(), ...evento }));
        }
      });

      return completo;
    },

    /** Suma un delta a un fondo y deja la entrada en su ledger. */
    async aplicarEntradaFondo(entrada) {
      const crudo = await motor.obtener('funds', entrada.fundId);
      const fondo = crudo ? await abrir('funds', crudo) : { id: entrada.fundId, saldoCents: 0 };
      const actualizado = {
        ...fondo,
        saldoCents: (fondo.saldoCents ?? 0) + entrada.delta,
        actualizadoEn: entrada.ts ?? Date.now(),
      };
      await motor.guardar('funds', await sellar('funds', actualizado));
      await motor.guardar('fundEntries', await sellar('fundEntries', { ts: Date.now(), ...entrada }));
      return actualizado;
    },

    /**
     * Aplica un plan de cierre. La idempotencia vive aqui: la transicion de
     * estado se comprueba dentro de la transaccion, asi que dos invocaciones
     * simultaneas no producen dos cierres.
     */
    async aplicarCierre(plan) {
      return motor.transaccion(
        ['periods', 'archives', 'funds', 'fundEntries', 'auditLog', 'allocations', 'sobrantes'],
        async () => {
          const actual = await repo.periodo(plan.periodoCerrado.id);
          if (!actual || actual.status !== 'abierto') {
            return { aplicado: false, motivo: 'YA_CERRADO' };
          }

          await motor.guardar('periods', await sellar('periods', plan.periodoCerrado));
          await motor.guardar(
            'archives',
            await sellar('archives', {
              periodId: plan.periodoCerrado.id,
              formatVersion: 1,
              informe: plan.informe,
              archivadoEn: Date.now(),
            }),
          );

          for (const e of plan.entradasFondo) {
            await repo.aplicarEntradaFondo(e);
          }

          // El sobrante se congela aqui. No se sobrescribe si ya existiera.
          if (plan.sobrante && !(await motor.obtener('sobrantes', plan.sobrante.periodId))) {
            await motor.guardar('sobrantes', await sellar('sobrantes', plan.sobrante));
          }

          const yaExiste = await motor.obtener('periods', plan.periodoNuevo.id);
          if (!yaExiste) {
            await motor.guardar('periods', await sellar('periods', plan.periodoNuevo));
          }

          await motor.guardar(
            'auditLog',
            await sellar('auditLog', {
              ts: Date.now(),
              tipo: 'CICLO_CERRADO',
              periodId: plan.periodoCerrado.id,
              detalle: {
                aFondo: plan.carry.aFondo,
                aCartera: plan.carry.aCartera,
                expirado: plan.carry.expirado,
                descuadre: plan.descuadre.hay,
              },
            }),
          );

          if (plan.descuadre.hay) {
            await motor.guardar(
              'auditLog',
              await sellar('auditLog', {
                ts: Date.now(),
                tipo: 'DESCUADRE_DETECTADO',
                periodId: plan.periodoCerrado.id,
                detalle: plan.descuadre.diferencias,
              }),
            );
          }

          return { aplicado: true };
        },
      );
    },

    // --- mantenimiento ----------------------------------------------------

    async vaciar() {
      await motor.vaciar();
      deviceIdCache = null;
    },

    async exportar() {
      return motor.exportar();
    },

    async importar(plano) {
      await motor.importar(plano);
      deviceIdCache = null;
    },

    async estadisticas() {
      return {
        movimientos: await motor.contar('movements'),
        periodos: await motor.contar('periods'),
        asignaciones: await motor.contar('allocations'),
        eventos: await motor.contar('auditLog'),
        motor: motor.tipo,
        persistente: motor.persistente,
      };
    },
  };

  return repo;
}
