/**
 * Cierre de ciclo perezoso e idempotente (§8).
 *
 * El requisito dice «dia 1 a las 00:00». En una PWA de iOS no existe ningun
 * mecanismo que ejecute codigo a esa hora con la app cerrada. La solucion no
 * es aproximar la hora: es quitarle importancia al instante de ejecucion.
 *
 * El cierre es funcion pura de (ultimoPeriodoCerrado, ahora). Abrir la app el
 * dia 7 cierra agosto con fecha efectiva del 1 a las 00:00 locales; si el
 * usuario estuvo tres meses fuera, cierra los tres en orden.
 */

import { ORDEN, ceros, PESOS_POR_DEFECTO } from './buckets.js';
import { crearPeriodo, periodoDe, siguientePeriodo, comparaPeriodos, recalcularTotales, utilizacion } from './periodo.js';
import { calcularCarry, POLITICA_POR_DEFECTO } from './carry.js';
import { crearSobrante } from './sobrante.js';
import { sumar } from './dinero.js';

/**
 * Periodos que deberian estar cerrados y no lo estan.
 * Devuelve [] en el caso normal, que es el 99 % de las aperturas.
 *
 * @param {string|null} ultimoCerrado periodId o null si nunca se cerro nada
 * @param {number} ahora marca de tiempo
 * @param {string} zona zona horaria IANA
 * @param {string|null} primerPeriodo periodId del primer periodo con datos
 */
export function periodosPendientes(ultimoCerrado, ahora, zona, primerPeriodo = null) {
  const actual = periodoDe(ahora, zona);
  const arranque = ultimoCerrado ? siguientePeriodo(ultimoCerrado) : primerPeriodo;
  if (!arranque) return [];

  const pendientes = [];
  let p = arranque;
  let guarda = 0;
  while (comparaPeriodos(p, actual) < 0) {
    if (++guarda > 600) break; // 50 años: proteccion frente a datos corruptos
    pendientes.push(p);
    p = siguientePeriodo(p);
  }
  return pendientes;
}

/**
 * Planifica el cierre de un periodo. NO escribe: describe lo que hay que hacer.
 * El adaptador de persistencia aplica el plan dentro de una sola transaccion,
 * que es donde vive la idempotencia real (transicion abierto -> cerrando -> cerrado).
 *
 * @returns {{ periodoCerrado, informe, entradasFondo, periodoNuevo, descuadre }}
 */
export function planificarCierre(periodo, movimientos, asignaciones, opciones = {}) {
  const {
    politicaCarry = POLITICA_POR_DEFECTO,
    baseFija = null,
    pesosSiguiente = periodo.pesos ?? PESOS_POR_DEFECTO,
    eventos = [],
    ahora = Date.now(),
  } = opciones;

  // 1 · recalcular y verificar contra los totales materializados (AD-05)
  const recalculado = recalcularTotales(periodo, movimientos, asignaciones);
  const descuadre = detectarDescuadre(periodo, recalculado);
  const p = { ...periodo, techos: recalculado.techos, totales: recalculado.totales, ingresoTotal: recalculado.ingresoTotal, sinRegistrar: recalculado.sinRegistrar };

  // 2 · carry-forward
  const carry = calcularCarry(p, politicaCarry);

  // 3 · sobrante del mes: lo que queda libre de Esenciales y Recompensas.
  //     Es un hecho del mes y se congela aqui; lo que el usuario haga luego
  //     con el se registra aparte y nunca reescribe esta cifra (§12).
  const registroSobrante = crearSobrante(p, ahora);

  // 4 · informe
  const informe = generarInforme(p, movimientos, eventos, carry, { descuadre, sobrante: registroSobrante });

  // 5 · entradas de fondo
  const entradasFondo = [];
  if (carry.aFondo > 0) {
    entradasFondo.push({
      fundId: 'FONDO_AHORRO',
      periodId: p.id,
      delta: carry.aFondo,
      motivo: 'carry-forward de Reserva',
      ts: ahora,
    });
  }
  if (carry.aCartera > 0) {
    entradasFondo.push({
      fundId: 'CARTERA_INVERSION',
      periodId: p.id,
      delta: carry.aCartera,
      motivo: 'consolidación de Inversión',
      ts: ahora,
    });
  }

  // 6 · periodo siguiente
  const idSiguiente = siguientePeriodo(p.id);
  const periodoNuevo = crearPeriodo(idSiguiente, {
    pesos: pesosSiguiente,
    topes: periodo.topes ?? {},
    abiertoEn: ahora,
  });
  periodoNuevo.carryIn = carry.aReservaSiguiente;
  if (carry.aReservaSiguiente > 0) {
    periodoNuevo.techos.RESERVA += carry.aReservaSiguiente;
  }

  const periodoCerrado = {
    ...p,
    status: 'cerrado',
    cerradoEn: ahora,
    carryOut: carry.aFondo + carry.aCartera + carry.aReservaSiguiente,
  };

  return { periodoCerrado, informe, entradasFondo, periodoNuevo, carry, descuadre, baseFija, sobrante: registroSobrante };
}

/** Compara totales materializados contra el recalculo. */
function detectarDescuadre(periodo, recalculado) {
  const diferencias = [];
  for (const b of ORDEN) {
    const guardadoT = periodo.techos?.[b] ?? 0;
    const guardadoG = periodo.totales?.[b] ?? 0;
    if (guardadoT !== recalculado.techos[b]) {
      diferencias.push({ bucket: b, campo: 'techo', guardado: guardadoT, real: recalculado.techos[b] });
    }
    if (guardadoG !== recalculado.totales[b]) {
      diferencias.push({ bucket: b, campo: 'total', guardado: guardadoG, real: recalculado.totales[b] });
    }
  }
  return diferencias.length ? { hay: true, diferencias } : { hay: false, diferencias: [] };
}

/** Informe mensual archivable. */
export function generarInforme(periodo, movimientos, eventos, carry, extra = {}) {
  const porBucket = ORDEN.map((bucket) => {
    const techo = periodo.techos[bucket] ?? 0;
    const gastado = periodo.totales[bucket] ?? 0;
    const linea = carry.lineas.find((l) => l.bucket === bucket);
    const sobrepaso = carry.sobrepasos.find((s) => s.bucket === bucket);
    return {
      bucket,
      techo,
      gastado,
      restante: techo - gastado,
      utilizacion: utilizacion(periodo, bucket),
      destinoRemanente: linea?.destino ?? null,
      remanenteCents: linea?.centavos ?? 0,
      excesoCents: sobrepaso?.excesoCents ?? 0,
    };
  });

  const rechazos = eventos.filter((e) => e.tipo === 'REGLA_RECHAZO');
  const forzados = eventos.filter((e) => e.tipo === 'REGLA_FORZADO');
  const excepciones = eventos.filter((e) => e.tipo === 'REGLA_ANULADA');

  const gastos = movimientos.filter((m) => m.tipo === 'gasto');
  const ingresos = movimientos.filter((m) => m.tipo === 'ingreso');

  const cobrosIncompletos = agruparCobrosIncompletos(ingresos);

  return {
    periodId: periodo.id,
    formatVersion: 1,
    generadoEn: Date.now(),
    ingresoTotal: periodo.ingresoTotal ?? sumar(ingresos.map((m) => m.importeCents)),
    gastoTotal: sumar(gastos.map((m) => m.importeCents)),
    movimientos: movimientos.length,
    porBucket,
    carry: {
      aFondo: carry.aFondo,
      aCartera: carry.aCartera,
      aReservaSiguiente: carry.aReservaSiguiente,
      expirado: carry.expirado,
    },
    reglas: {
      rechazos: rechazos.length,
      forzados: forzados.length,
      excepciones: excepciones.length,
      porRegla: contarPorRegla([...rechazos, ...forzados, ...excepciones]),
    },
    sobranteCents: extra.sobrante?.sobranteCents ?? 0,
    sobranteDesglose: extra.sobrante?.desglose ?? null,
    cobrosIncompletos,
    descuadre: extra.descuadre?.hay ? extra.descuadre.diferencias : null,
  };
}

function contarPorRegla(eventos) {
  const conteo = {};
  for (const e of eventos) {
    if (!e.ruleId) continue;
    conteo[e.ruleId] = (conteo[e.ruleId] ?? 0) + 1;
  }
  return conteo;
}

/** Grupos de liquidacion que no alcanzaron el total pactado (§6.3). */
function agruparCobrosIncompletos(ingresos) {
  const grupos = new Map();
  for (const m of ingresos) {
    if (!m.grupoLiquidacion) continue;
    const g = grupos.get(m.grupoLiquidacion) ?? { grupo: m.grupoLiquidacion, cobrado: 0, pactado: 0 };
    g.cobrado += m.importeCents;
    if (m.totalPactadoCents) g.pactado = Math.max(g.pactado, m.totalPactadoCents);
    grupos.set(m.grupoLiquidacion, g);
  }
  return [...grupos.values()]
    .filter((g) => g.pactado > 0 && g.cobrado < g.pactado)
    .map((g) => ({ ...g, pendiente: g.pactado - g.cobrado }));
}

/**
 * Ingreso mensual normal: asignacion estructural al abrir el periodo (§14).
 *
 * Se pregunta una sola vez, en el alta, y a partir de ahi entra solo cada dia 1
 * con el reparto habitual 50/25/15/10. Es lo que sustituye al anclaje manual de
 * saldo que habia que teclear todos los meses.
 *
 * Idempotente por el flag baseFijaAplicada del propio periodo.
 */
export function planificarIngresoNormal(periodo, ingresoNormal) {
  if (!ingresoNormal?.configurado) return null;
  if (periodo.baseFijaAplicada) return null;
  if (!(ingresoNormal.montoCents > 0)) return null;
  return { montoCents: ingresoNormal.montoCents, pesos: ingresoNormal.pesos ?? periodo.pesos };
}

export { ceros };
