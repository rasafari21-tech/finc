/**
 * Capa de comandos: orquesta dominio y persistencia.
 *
 * El dominio decide, el repositorio escribe. Aqui no hay reglas de negocio
 * nuevas, solo el pegamento y el orden correcto de las operaciones.
 */

import { nuevoId } from '../datos/esquema.js';
import { ORDEN, ceros, FONDO_AHORRO, CARTERA_INVERSION, RESERVA } from '../dominio/buckets.js';
import { crearPeriodo, periodoDe, fechaLocal, recalcularTotales, diasEnPeriodo } from '../dominio/periodo.js';
import { repartirIngreso } from '../dominio/reparto.js';
import { evaluarMovimiento, aplicarVeredicto, sugerirDestino, medianaDe } from '../dominio/clasificador.js';
import { periodosPendientes, planificarCierre, planificarIngresoNormal } from '../dominio/cierre.js';
import { diagnosticar, redactarAlerta } from '../dominio/diagnostico.js';
import { POR_ID as CATEGORIAS } from '../dominio/categorias.js';
import { distribuirInformal, limpiarSeleccion } from '../dominio/informales.js';
import {
  validarDestino, destinoAutomatico, categoriaDe, destinosDe,
} from '../dominio/destinos.js';
// destinoAutomatico se usa para rellenar el destino unico de Reserva.
import {
  crearSobrante, resolverSobrante as resolverRegistro, sobranteProyectado,
  esVisperaDeCierre, DESTINOS_SOBRANTE, mediaSobrante,
} from '../dominio/sobrante.js';

/**
 * Comprime y descomprime con la API del navegador, sin dependencias.
 * En Node (los tests) CompressionStream tambien existe desde la v18.
 */
async function comprimir(texto) {
  if (typeof CompressionStream === 'undefined') return texto; // sin soporte: se guarda tal cual
  const flujo = new Blob([texto]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(flujo).arrayBuffer());
  let binario = '';
  for (const b of bytes) binario += String.fromCharCode(b);
  return `gz:${btoa(binario)}`;
}

async function descomprimir(dato) {
  if (typeof dato !== 'string' || !dato.startsWith('gz:')) return dato;
  const binario = atob(dato.slice(3));
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  const flujo = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(flujo).text();
}

export function crearComandos(repo, reloj) {
  /** Cierre en vuelo, para que varios disparadores simultaneos no dupliquen trabajo. */
  let cierreEnCurso = null;

  async function ejecutarCierresPendientes() {
    const ultimo = await repo.ultimoCerrado();
    const primero = await repo.primerPeriodo();
    const pendientes = periodosPendientes(ultimo, reloj.ahora(), reloj.zona, primero);
    const hechos = [];

    for (const periodId of pendientes) {
      const resultado = await comandos.cerrarPeriodo(periodId);
      if (resultado.aplicado) hechos.push(resultado);
    }
    return hechos;
  }

  /** Contexto que necesitan las reglas para evaluar un movimiento. */
  async function contextoDeReglas(periodo) {
    const desde = reloj.ahora() - 30 * 86_400_000;
    const recientes = await repo.movimientosDesde(desde);
    const gastos = recientes.filter((m) => m.tipo === 'gasto');
    const cerrados = (await repo.periodosCerrados()).map((p) => p.id);
    const ajustes = await repo.ajustes();

    return {
      categorias: CATEGORIAS,
      periodo,
      fechaHoy: reloj.fecha(),
      movimientosRecientes: recientes,
      medianaImporte: medianaDe(gastos.map((m) => m.importeCents)),
      periodosCerrados: cerrados,
      reglasUsuario: ajustes?.reglasUsuario ?? [],
      historialComercio: construirHistorialComercio(gastos),
    };
  }

  function construirHistorialComercio(gastos) {
    const mapa = {};
    for (const m of gastos) {
      if (!m.comercio) continue;
      const e = (mapa[m.comercio] ??= { conteo: 0, buckets: {}, categorias: {} });
      e.conteo += 1;
      e.buckets[m.bucket] = (e.buckets[m.bucket] ?? 0) + 1;
      e.categorias[m.categoryId] = (e.categorias[m.categoryId] ?? 0) + 1;
    }
    for (const e of Object.values(mapa)) {
      e.bucket = Object.entries(e.buckets).sort((a, b) => b[1] - a[1])[0]?.[0];
      e.categoryId = Object.entries(e.categorias).sort((a, b) => b[1] - a[1])[0]?.[0];
    }
    return mapa;
  }

  /** Normaliza lo que llega de la interfaz a la forma que espera el dominio. */
  function normalizar(cmd, tipo) {
    const ts = cmd.ts ?? reloj.ahora();
    const localDate = cmd.localDate ?? fechaLocal(ts, reloj.zona);
    return {
      id: cmd.id ?? nuevoId(ts),
      tipo,
      ts,
      localDate,
      periodId: cmd.periodId ?? periodoDe(ts, reloj.zona),
      importeCents: cmd.importeCents,
      bucket: cmd.bucket ?? null,
      categoryId: cmd.categoryId ?? null,
      destinoId: cmd.destinoId ?? null,
      destinoTexto: (cmd.destinoTexto ?? '').trim() || null,
      comercio: cmd.comercio ?? null,
      comercioTipo: cmd.comercioTipo ?? null,
      nota: cmd.nota ?? '',
      tags: cmd.tags ?? [],
      razonReserva: cmd.razonReserva ?? null,
      usoProfesional: cmd.usoProfesional ?? false,
      certificable: cmd.certificable ?? false,
      relacionadaConIngreso: cmd.relacionadaConIngreso ?? false,
      corrigeA: cmd.corrigeA ?? null,
      grupoLiquidacion: cmd.grupoLiquidacion ?? null,
      totalPactadoCents: cmd.totalPactadoCents ?? null,
      claseIngreso: cmd.claseIngreso ?? null,
      origen: cmd.origen ?? 'manual',
    };
  }

  const comandos = {
    /**
     * Arranque: crea el almacen si hace falta y ejecuta los cierres pendientes.
     * Se invoca ANTES del primer render de datos.
     */
    async arrancar() {
      const ajustes = await repo.inicializar(reloj.zona);
      const cierres = await comandos.asegurarPeriodos();
      const periodo = await comandos.periodoActual();
      return {
        ajustes,
        cierres,
        periodo,
        necesitaAlta: !ajustes?.ingresoNormal?.configurado,
      };
    },

    /** Devuelve el periodo abierto, creandolo si no existe. */
    async periodoActual() {
      const idActual = reloj.periodo();
      let p = await repo.periodo(idActual);
      if (!p) {
        const ajustes = await repo.ajustes();
        p = crearPeriodo(idActual, {
          pesos: ajustes?.pesos,
          topes: ajustes?.topes,
          abiertoEn: reloj.ahora(),
        });
        await repo.guardarPeriodo(p);
        p = await comandos.aplicarIngresoNormalSiProcede(p);
      }
      return p;
    },

    /**
     * Cierre perezoso (§8). Idempotente: invocarlo cinco veces seguidas
     * produce un unico cierre.
     *
     * Dos capas de proteccion. Esta de aqui evita el trabajo duplicado cuando
     * varios disparadores coinciden —arranque, vuelta a primer plano y push
     * del dia 1 pueden llegar juntos—. La que de verdad garantiza la
     * idempotencia es la transicion de estado dentro de la transaccion, en
     * repo.aplicarCierre.
     */
    async asegurarPeriodos() {
      if (cierreEnCurso) return cierreEnCurso;
      cierreEnCurso = (async () => {
        try {
          return await ejecutarCierresPendientes();
        } finally {
          cierreEnCurso = null;
        }
      })();
      return cierreEnCurso;
    },

    async cerrarPeriodo(periodId) {
      const periodo = await repo.periodo(periodId);
      if (!periodo || periodo.status !== 'abierto') {
        return { aplicado: false, periodId, motivo: 'NO_ABIERTO' };
      }

      const ajustes = await repo.ajustes();
      const movimientos = await repo.movimientos({ periodId, descendente: false });
      const asignaciones = await repo.asignaciones(periodId);
      const eventos = await repo.eventos({ periodId });

      const plan = planificarCierre(periodo, movimientos, asignaciones, {
        politicaCarry: ajustes?.politicaCarry,
        pesosSiguiente: ajustes?.pesos,
        eventos,
        ahora: reloj.ahora(),
      });

      const resultado = await repo.aplicarCierre(plan);
      if (!resultado.aplicado) return { aplicado: false, periodId, motivo: resultado.motivo };

      const nuevo = await repo.periodo(plan.periodoNuevo.id);
      if (nuevo) await comandos.aplicarIngresoNormalSiProcede(nuevo);

      const dx = await comandos.diagnostico();
      return {
        aplicado: true,
        periodId,
        informe: plan.informe,
        carry: plan.carry,
        sobrante: plan.sobrante,
        diagnostico: dx,
      };
    },

    /** Ingreso mensual normal al abrir el periodo (§14). */
    async aplicarIngresoNormalSiProcede(periodo) {
      const ajustes = await repo.ajustes();
      const plan = planificarIngresoNormal(periodo, ajustes?.ingresoNormal);
      if (!plan) return periodo;

      const { asignado, aFondo, lineas } = repartirIngreso(plan.montoCents, {
        pesos: plan.pesos ?? periodo.pesos,
        techosActuales: periodo.techos,
        topes: periodo.topes ?? {},
        cascada: ajustes?.cascada ?? {},
      });

      const techos = { ...periodo.techos };
      for (const b of ORDEN) techos[b] += asignado[b];

      const mov = normalizar(
        {
          importeCents: plan.montoCents,
          categoryId: 'nomina',
          periodId: periodo.id,
          origen: 'ingreso-normal',
          claseIngreso: 'normal',
          nota: 'Ingreso mensual normal',
        },
        'ingreso',
      );

      const actualizado = {
        ...periodo,
        techos,
        ingresoTotal: (periodo.ingresoTotal ?? 0) + plan.montoCents,
        baseFijaAplicada: true,
      };

      await repo.escribirMovimiento({
        mov,
        asignaciones: lineas
          .filter((l) => l.bucket !== FONDO_AHORRO)
          .map((l) => ({ movementId: mov.id, bucket: l.bucket, centavos: l.centavos, motivo: 'ingreso-normal' })),
        periodo: actualizado,
        evento: { tipo: 'INGRESO_NORMAL_APLICADO', periodId: periodo.id, detalle: { montoCents: plan.montoCents } },
        entradasFondo: aFondo > 0
          ? [{ fundId: FONDO_AHORRO, periodId: periodo.id, delta: aFondo, motivo: 'cascada del ingreso normal' }]
          : [],
      });

      return actualizado;
    },

    /** Alta inicial y cambios posteriores del ingreso normal (§14, §15). */
    async configurarIngresoNormal(montoCents, { aplicarYa = true } = {}) {
      if (!(montoCents > 0)) return { ok: false, codigo: 'IMPORTE_NO_POSITIVO' };

      const ajustes = await repo.ajustes();
      await repo.guardarAjustes({
        ...ajustes,
        ingresoNormal: { ...ajustes.ingresoNormal, montoCents, configurado: true },
      });
      await repo.agregarEvento({ tipo: 'INGRESO_NORMAL_CAMBIADO', detalle: { montoCents } });

      if (aplicarYa) {
        const periodo = await comandos.periodoActual();
        if (!periodo.baseFijaAplicada) await comandos.aplicarIngresoNormalSiProcede(periodo);
      }
      return { ok: true, montoCents };
    },

    // --- registro de gastos ----------------------------------------------

    /**
     * Registra un gasto. Devuelve { ok } o { ok: false, veredicto, sugerencia }
     * para que la interfaz muestre la hoja de rechazo (§7.3).
     */
    async registrarGasto(cmd) {
      const periodo = await comandos.periodoActual();
      const ajustes = await repo.ajustes();
      const mov = normalizar(cmd, 'gasto');

      // El destino manda sobre la categoria: es lo que el usuario eligio.
      if (mov.bucket && destinosDe(ajustes, mov.bucket).length > 0) {
        // Reserva tiene un unico destino y la interfaz lo pone sola. Aqui se
        // hace lo mismo, para que la API no exija algo que no se pregunta.
        if (!mov.destinoId) {
          const automatico = destinoAutomatico(ajustes, mov.bucket);
          if (automatico) mov.destinoId = automatico.id;
        }
        const v = validarDestino(ajustes, mov.bucket, mov.destinoId, mov.destinoTexto);
        if (!v.ok) return { ok: false, faltaDestino: v.codigo, etiqueta: v.etiqueta, bucket: mov.bucket };
        mov.categoryId = categoriaDe(mov.destinoId, mov.bucket) ?? mov.categoryId;
      }

      const ctx = await contextoDeReglas(periodo);
      const veredicto = evaluarMovimiento(mov, ctx);
      const aplicado = aplicarVeredicto(mov, veredicto, {
        justificacion: cmd.justificacion,
        aceptaForzado: cmd.aceptaForzado,
        confirmado: cmd.confirmado,
      });

      if (!aplicado.permitido) {
        await repo.agregarEvento({
          tipo: 'REGLA_RECHAZO',
          ruleId: veredicto.ruleId,
          periodId: mov.periodId,
          detalle: { bucket: mov.bucket, categoryId: mov.categoryId, importeCents: mov.importeCents },
        });
        return {
          ok: false,
          veredicto,
          sugerencia: sugerirDestino(mov, veredicto, ctx),
          requiere: aplicado.requiere,
        };
      }

      const definitivo = aplicado.mov;
      const totales = { ...periodo.totales };
      if (totales[definitivo.bucket] !== undefined) {
        totales[definitivo.bucket] += definitivo.importeCents;
      }

      const evento =
        veredicto.tipo === 'FORCE'
          ? { tipo: 'REGLA_FORZADO', ruleId: veredicto.ruleId, periodId: mov.periodId, detalle: { de: definitivo.bucketOriginal, a: definitivo.bucket } }
          : veredicto.tipo === 'AVISO'
            ? { tipo: 'REGLA_AVISO', ruleId: veredicto.ruleId, periodId: mov.periodId, detalle: { bucket: definitivo.bucket, importeCents: definitivo.importeCents } }
            : definitivo.justificacion
              ? { tipo: 'REGLA_ANULADA', ruleId: veredicto.ruleId, periodId: mov.periodId, detalle: { justificacion: definitivo.justificacion } }
              : null;

      const actualizado = { ...periodo, totales };

      // Sobrepaso de techo: se registra, nunca se bloquea (§6.4).
      const excedido = actualizado.totales[definitivo.bucket] > (actualizado.techos[definitivo.bucket] ?? 0);
      const yaEstabaExcedido = periodo.totales[definitivo.bucket] > (periodo.techos[definitivo.bucket] ?? 0);

      await repo.escribirMovimiento({ mov: definitivo, periodo: actualizado, evento });

      if (excedido && !yaEstabaExcedido) {
        await repo.agregarEvento({
          tipo: 'TECHO_REBASADO',
          periodId: definitivo.periodId,
          detalle: {
            bucket: definitivo.bucket,
            excesoCents: actualizado.totales[definitivo.bucket] - (actualizado.techos[definitivo.bucket] ?? 0),
          },
        });
      }

      return {
        ok: true,
        movimiento: definitivo,
        veredicto,
        aviso: aplicado.aviso ? veredicto : null,
        periodo: actualizado,
        rebasado: excedido,
      };
    },

    // --- ingresos informales ---------------------------------------------

    /**
     * Registra un ingreso informal.
     *
     * Va a los techos que venga marcados, dividido en partes iguales. Si no
     * se dice nada, Inversion y Reserva, que es lo de casi siempre. No
     * pregunta ni interrumpe: la eleccion se hace en las fichas, antes de
     * pulsar guardar, y ahi se ve el reparto al vuelo.
     */
    async registrarIngreso(cmd) {
      const periodo = await comandos.periodoActual();
      const importeCents = cmd.importeCents;

      if (!(importeCents > 0)) {
        return { ok: false, veredicto: { tipo: 'DENY', mensaje: 'El importe debe ser mayor que cero.' } };
      }

      const reparto = distribuirInformal(importeCents, periodo, {
        buckets: limpiarSeleccion(cmd.buckets),
      });

      const mov = normalizar(
        { ...cmd, categoryId: cmd.categoryId ?? 'otro-ingreso', claseIngreso: 'informal' },
        'ingreso',
      );

      const techos = { ...periodo.techos };
      for (const b of ORDEN) techos[b] += reparto.partes[b];

      const actualizado = {
        ...periodo,
        techos,
        ingresoTotal: (periodo.ingresoTotal ?? 0) + importeCents,
      };

      await repo.escribirMovimiento({
        mov,
        asignaciones: ORDEN.filter((b) => reparto.partes[b] > 0).map((b) => ({
          movementId: mov.id,
          bucket: b,
          centavos: reparto.partes[b],
          motivo: 'informal',
        })),
        periodo: actualizado,
        evento: {
          tipo: 'INGRESO_INFORMAL',
          periodId: periodo.id,
          detalle: { importeCents, seleccion: reparto.seleccion, partes: reparto.partes },
        },
      });

      return { ok: true, movimiento: mov, reparto: reparto.partes, detalleReparto: reparto, periodo: actualizado };
    },

    // --- corregir lo ya registrado --------------------------------------

    /** Un movimiento con lo que la interfaz necesita para enseñarlo y juzgarlo. */
    async movimiento(id) {
      const abierto = await comandos.periodoActual();
      const cerrados = (await repo.periodosCerrados()).map((p) => p.id);

      for (const periodId of [abierto.id, ...cerrados]) {
        const movs = await repo.movimientos({ periodId });
        const m = movs.find((x) => x.id === id);
        if (m) return { movimiento: m, editable: periodId === abierto.id, periodId };
      }
      return null;
    },

    /**
     * Anula un movimiento del mes abierto.
     *
     * El ledger es inmutable a proposito, pero eso no puede significar que un
     * cero de mas quede grabado para siempre. Dentro del mes abierto se borra
     * de verdad y se recalcula el periodo desde sus movimientos, que es
     * exactamente lo que ya hacia deshacer. En un mes cerrado no se toca nada:
     * el archivo es inmutable y ahi si manda R-18.
     */
    async anularMovimiento(id) {
      const encontrado = await comandos.movimiento(id);
      if (!encontrado) return { ok: false, codigo: 'NO_ENCONTRADO' };
      if (!encontrado.editable) return { ok: false, codigo: 'MES_CERRADO', periodId: encontrado.periodId };

      const { movimiento: mov, periodId } = encontrado;

      await repo.motor.transaccion(['movements', 'allocations', 'periods', 'auditLog'], async () => {
        await repo.motor.borrar('movements', mov.id);
        const asigs = await repo.asignaciones(periodId);
        for (const a of asigs.filter((x) => x.movementId === mov.id)) {
          await repo.motor.borrar('allocations', a.id);
        }
      });

      await repo.agregarEvento({
        tipo: 'MOVIMIENTO_ANULADO',
        periodId,
        detalle: { id: mov.id, importeCents: mov.importeCents, bucket: mov.bucket },
      });
      const periodo = await comandos.recalcularPeriodo(periodId);
      return { ok: true, periodo };
    },

    /**
     * Corrige un movimiento del mes abierto.
     *
     * Se anula y se vuelve a registrar con los datos nuevos, para que pase por
     * las mismas reglas que cualquier otro. Si el nuevo importe choca con una
     * regla, se devuelve el veredicto y NO se pierde el original: la anulacion
     * solo se confirma cuando el reemplazo entra.
     */
    async editarMovimiento(id, cambios) {
      const encontrado = await comandos.movimiento(id);
      if (!encontrado) return { ok: false, codigo: 'NO_ENCONTRADO' };
      if (!encontrado.editable) return { ok: false, codigo: 'MES_CERRADO', periodId: encontrado.periodId };

      const original = encontrado.movimiento;
      const anulado = await comandos.anularMovimiento(id);
      if (!anulado.ok) return anulado;

      const rehacer = {
        importeCents: cambios.importeCents ?? original.importeCents,
        bucket: cambios.bucket ?? original.bucket,
        categoryId: cambios.categoryId ?? original.categoryId,
        destinoId: cambios.destinoId ?? original.destinoId,
        destinoTexto: cambios.destinoTexto ?? original.destinoTexto,
        nota: cambios.nota ?? original.nota,
        tags: original.tags,
        razonReserva: original.razonReserva,
        localDate: cambios.localDate ?? original.localDate,
        ts: cambios.ts ?? original.ts,
        // El bucket ya es el que la regla forzo en su dia, asi que un FORCE no
        // vuelve a saltar. Pero `confirmado` NO se hereda: si la correccion
        // trae otro cero de mas, R-17 tiene que volver a preguntarlo. Ese es
        // justo el momento en que mas facil es equivocarse otra vez.
        aceptaForzado: true,
        confirmado: cambios.confirmado ?? false,
        justificacion: original.justificacion,
      };

      const r = original.tipo === 'ingreso'
        ? await comandos.registrarIngreso({ ...rehacer, buckets: cambios.buckets })
        : await comandos.registrarGasto(rehacer);

      if (!r.ok) {
        // El reemplazo no entro: se repone el original para no perder nada.
        await repo.escribirMovimiento({ mov: original, periodo: await comandos.periodoActual() });
        await comandos.recalcularPeriodo(encontrado.periodId);
        return { ok: false, codigo: 'RECHAZADO', veredicto: r.veredicto, requiere: r.requiere };
      }

      await repo.agregarEvento({
        tipo: 'MOVIMIENTO_CORREGIDO',
        periodId: encontrado.periodId,
        detalle: { de: original.importeCents, a: rehacer.importeCents, idOriginal: id },
      });
      return { ok: true, movimiento: r.movimiento };
    },

    // --- historial (UX-02) ------------------------------------------------

    /**
     * Movimientos de un mes, agrupados por dia y filtrables.
     *
     * Es la respuesta a «¿en que se me fue el mes?», que hasta ahora no
     * existia dentro de la app: lo unico consultable eran los diez ultimos de
     * un techo, enterrados en la hoja de detalle.
     */
    async historial({ periodId, bucket = null, texto = '', limite = 120 } = {}) {
      const mes = periodId ?? (await comandos.periodoActual()).id;
      const ajustes = await repo.ajustes();
      const movimientos = await repo.movimientos({ periodId: mes, descendente: true });

      const busca = texto.trim().toLowerCase();
      const coincide = (m) => {
        if (bucket && m.bucket !== bucket) return false;
        if (!busca) return true;
        const cat = CATEGORIAS[m.categoryId]?.nombre ?? '';
        const dest = m.destinoTexto ?? destinosDe(ajustes, m.bucket).find((d) => d.id === m.destinoId)?.nombre ?? '';
        return `${m.nota} ${cat} ${dest}`.toLowerCase().includes(busca);
      };

      const filtrados = movimientos.filter(coincide).slice(0, limite);

      // Agrupado por dia, que es como se recuerda el gasto.
      const dias = [];
      for (const m of filtrados) {
        const ultimo = dias[dias.length - 1];
        if (ultimo?.fecha === m.localDate) ultimo.movimientos.push(m);
        else dias.push({ fecha: m.localDate, movimientos: [m] });
      }
      for (const d of dias) {
        d.gastado = d.movimientos.filter((m) => m.tipo === 'gasto').reduce((a, m) => a + m.importeCents, 0);
        d.ingresado = d.movimientos.filter((m) => m.tipo === 'ingreso').reduce((a, m) => a + m.importeCents, 0);
      }

      return {
        periodId: mes,
        dias,
        total: filtrados.length,
        hayMas: movimientos.filter(coincide).length > filtrados.length,
        filtro: { bucket, texto },
      };
    },

    /** Meses con datos, del mas reciente al mas antiguo, para los selectores. */
    async mesesDisponibles() {
      const periodos = await repo.periodos();
      return periodos.map((p) => p.id).sort().reverse();
    },

    // --- copias de seguridad ---------------------------------------------

    /**
     * Mira una copia sin tocar nada y cuenta que trae.
     *
     * Restaurar sustituye todo lo que hay, asi que la decision no puede
     * tomarse a ciegas: esto es lo que se enseña antes de preguntar.
     */
    async analizarCopia(datos) {
      if (!datos || typeof datos !== 'object' || Array.isArray(datos)) {
        return { valido: false, motivo: 'El archivo no tiene la forma de una copia de finc.' };
      }
      const imprescindibles = ['periods', 'movements', 'settings'];
      const faltan = imprescindibles.filter((k) => !Array.isArray(datos[k]));
      if (faltan.length) {
        return { valido: false, motivo: `Al archivo le faltan datos (${faltan.join(', ')}).` };
      }

      const periodos = datos.periods.map((p) => p.id).filter(Boolean).sort();
      const actual = await repo.estadisticas();

      return {
        valido: true,
        entrante: {
          periodos: periodos.length,
          primerMes: periodos[0] ?? null,
          ultimoMes: periodos[periodos.length - 1] ?? null,
          movimientos: datos.movements.length,
          sobrantes: (datos.sobrantes ?? []).length,
          informes: (datos.archives ?? []).length,
        },
        actual: { periodos: actual.periodos, movimientos: actual.movimientos },
      };
    },

    /** Sustituye el almacen por el de la copia. Irreversible. */
    async restaurarCopia(datos) {
      const analisis = await comandos.analizarCopia(datos);
      if (!analisis.valido) return { ok: false, motivo: analisis.motivo };

      await repo.vaciar();
      await repo.importar(datos);

      // Los totales se rehacen desde los movimientos: si la copia venia de una
      // version anterior, el recalculo la deja coherente con el motor de hoy.
      for (const p of await repo.periodos()) {
        if (p.status === 'abierto') await comandos.recalcularPeriodo(p.id);
      }
      await repo.agregarEvento({ tipo: 'COPIA_RESTAURADA', detalle: analisis.entrante });
      return { ok: true, resumen: analisis.entrante };
    },

    /** Deshacer: solo dentro de la ventana de gracia (§11.1). */
    async deshacer(movimientoId, ventanaMs = 8000) {
      const periodo = await comandos.periodoActual();
      const movs = await repo.movimientos({ periodId: periodo.id, limite: 20 });
      const mov = movs.find((m) => m.id === movimientoId);
      if (!mov) return { ok: false, motivo: 'NO_ENCONTRADO' };
      if (reloj.ahora() - mov.ts > ventanaMs) return { ok: false, motivo: 'FUERA_DE_PLAZO' };

      await repo.motor.transaccion(['movements', 'allocations', 'periods', 'auditLog'], async () => {
        await repo.motor.borrar('movements', mov.id);
        const asigs = await repo.asignaciones(periodo.id);
        for (const a of asigs.filter((x) => x.movementId === mov.id)) {
          await repo.motor.borrar('allocations', a.id);
        }
      });

      await comandos.recalcularPeriodo(periodo.id);
      return { ok: true };
    },

    async recalcularPeriodo(periodId) {
      const periodo = await repo.periodo(periodId);
      if (!periodo) return null;
      const movimientos = await repo.movimientos({ periodId, descendente: false });
      const asignaciones = await repo.asignaciones(periodId);
      const actualizado = recalcularTotales(periodo, movimientos, asignaciones);
      await repo.guardarPeriodo(actualizado);
      return actualizado;
    },

    // --- sobrante mensual -------------------------------------------------

    /** Sobrante proyectado del mes en curso, y si toca ya avisar (§11). */
    async sobranteDelMes() {
      const periodo = await comandos.periodoActual();
      const proyectado = sobranteProyectado(periodo);
      const dias = diasEnPeriodo(periodo.id);
      return {
        ...proyectado,
        periodId: periodo.id,
        vispera: esVisperaDeCierre(reloj.fecha(), dias),
      };
    },

    async historialSobrantes() {
      const registros = await repo.sobrantes();
      return { registros, media: mediaSobrante(registros) };
    },

    /**
     * Decide que se hace con el sobrante ya registrado.
     * El importe no cambia: solo se anota el destino (§12).
     */
    async resolverSobrante(periodId, destinoId) {
      const registro = await repo.sobrante(periodId);
      if (!registro) return { ok: false, codigo: 'SIN_SOBRANTE' };
      if (registro.resueltoEn) return { ok: false, codigo: 'YA_RESUELTO' };

      const actualizado = resolverRegistro(registro, destinoId, reloj.ahora());
      await repo.guardarSobrante(actualizado);

      const destino = DESTINOS_SOBRANTE.find((d) => d.id === destinoId);
      if (destino?.fondo && registro.sobranteCents > 0) {
        await repo.aplicarEntradaFondo({
          fundId: destino.fondo,
          periodId,
          delta: registro.sobranteCents,
          motivo: `sobrante de ${periodId}`,
          ts: reloj.ahora(),
        });
      }

      await repo.agregarEvento({
        tipo: 'SOBRANTE_RESUELTO',
        periodId,
        detalle: { destino: destinoId, centavos: registro.sobranteCents },
      });

      return { ok: true, registro: actualizado };
    },

    // --- compactacion de meses frios (UX-15) ------------------------------

    /**
     * Comprime los periodos de mas de N meses y borra sus filas calientes.
     *
     * El historial vive entero en `movements`, que esta bien mientras son
     * cientos de filas y deja de estarlo cuando son cientos de miles. Aqui el
     * orden importa: se comprime ANTES de cifrar, porque el texto cifrado es
     * incompresible por definicion y el gzip no ahorraria nada.
     *
     * Se ejecuta en segundo plano tras un cierre, nunca durante: el cierre
     * tiene que terminar en milisegundos.
     */
    async compactarMesesFrios({ mesesCalientes = 24 } = {}) {
      const cerrados = await repo.periodosCerrados();
      const frios = cerrados.slice(0, Math.max(0, cerrados.length - mesesCalientes));
      if (!frios.length) return { compactados: 0, filas: 0 };

      let filas = 0;
      for (const p of frios) {
        const movimientos = await repo.movimientos({ periodId: p.id, descendente: false });
        if (!movimientos.length) continue;

        const archivo = (await repo.informe(p.id)) ?? null;
        const comprimido = await comprimir(JSON.stringify(movimientos));

        await repo.motor.transaccion(['archives', 'movements', 'allocations'], async () => {
          await repo.guardarArchivo({
            periodId: p.id,
            formatVersion: 1,
            informe: archivo,
            movimientosGz: comprimido,
            archivadoEn: reloj.ahora(),
          });
          for (const m of movimientos) await repo.motor.borrar('movements', m.id);
          for (const a of await repo.asignaciones(p.id)) await repo.motor.borrar('allocations', a.id);
        });
        filas += movimientos.length;
      }

      await repo.agregarEvento({
        tipo: 'MESES_COMPACTADOS',
        detalle: { meses: frios.map((p) => p.id), filas },
      });
      return { compactados: frios.length, filas };
    },

    /** Movimientos de un mes ya compactado, descomprimidos al vuelo. */
    async movimientosArchivados(periodId) {
      const archivo = await repo.archivo(periodId);
      if (!archivo?.movimientosGz) return null;
      return JSON.parse(await descomprimir(archivo.movimientosGz));
    },

    // --- diagnostico ------------------------------------------------------

    async diagnostico() {
      const cerrados = await repo.periodosCerrados();
      const dx = diagnosticar(cerrados);
      if (!dx) return null;
      return { ...dx, alerta: redactarAlerta(dx) };
    },

    async aplicarPropuesta(pesosBps) {
      const ajustes = await repo.ajustes();
      await repo.guardarAjustes({ ...ajustes, pesos: pesosBps });
      await repo.agregarEvento({ tipo: 'PESOS_CAMBIADOS', detalle: { pesos: pesosBps } });
      return pesosBps;
    },

    // --- lectura para la interfaz ----------------------------------------

    async instantanea() {
      const periodo = await comandos.periodoActual();
      const fondos = await repo.fondos();
      const ajustes = await repo.ajustes();
      const ultimos = await repo.movimientos({ periodId: periodo.id, limite: 12 });
      const dx = await comandos.diagnostico();
      const informes = await repo.informes();
      const sobrante = await comandos.sobranteDelMes();
      const sobrantes = await repo.sobrantes();
      const pendienteDeResolver = sobrantes.find((s) => !s.resueltoEn && s.sobranteCents > 0) ?? null;

      return {
        periodo,
        fondos,
        ajustes,
        ultimos,
        diagnostico: dx,
        ultimoInforme: informes[0] ?? null,
        sobrante,
        sobrantes,
        sobrantePendiente: pendienteDeResolver,
        necesitaAlta: !ajustes?.ingresoNormal?.configurado,
        fecha: reloj.fecha(),
        zona: reloj.zona,
      };
    },
  };

  return comandos;
}

export { ceros, ORDEN, RESERVA, CARTERA_INVERSION };
