/**
 * Arranque y cableado de la interfaz.
 *
 * Un unico oyente en la raiz resuelve todos los eventos por delegacion, y un
 * unico render repinta. A esta escala es mas rapido y mucho menos codigo que
 * cualquier framework.
 *
 * Sin pantalla de bloqueo: la app abre directa (§17). Lo unico que puede
 * interponerse es el alta, y solo la primera vez.
 */

import { crearMotor } from '../datos/motor-idb.js';
import { crearBoveda, haySubtle } from '../datos/boveda.js';
import { crearRepo } from '../datos/repo.js';
import { crearComandos } from './comandos.js';
import { relojReal } from './reloj.js';
import { crearEstado, capturaVacia } from './estado.js';

import { parsearCentavos, formatear } from '../dominio/dinero.js';
import { ORDEN, ETIQUETAS, FONDO_AHORRO, CARTERA_INVERSION } from '../dominio/buckets.js';
import { POR_ID as CATEGORIAS } from '../dominio/categorias.js';
import { destinosDe, destinoAutomatico } from '../dominio/destinos.js';
import { MODO, requierePreguntar, distribuirInformal } from '../dominio/informales.js';

import {
  cabecera, panelTechos, teclado, fichasBucket,
  previoReparto, visor, avisoDiagnostico, avisoSobrante, esc,
} from '../ui/componentes.js';
import {
  hojaRechazo, hojaDetalleTecho, hojaInforme, hojaDiagnostico, hojaCategorias,
  hojaAjustes, hojaFondos, hojaAlta, hojaDestinos, hojaDistribucion,
  hojaDistribucionManual, hojaSobrante,
} from '../ui/hojas.js';

const raiz = document.getElementById('app');
const capaHojas = document.getElementById('hojas');
const capaBrindis = document.getElementById('brindis');

const estado = crearEstado({
  cargando: true,
  captura: capturaVacia(),
  hoja: null,
  brindis: null,
  banda: null,
});

let repo;
let comandos;
let boveda;
let reloj;
let temporizadorBrindis = null;

// =========================================================================
// Arranque
// =========================================================================

async function arrancar() {
  reloj = relojReal();
  const motor = await crearMotor();
  boveda = crearBoveda();
  repo = crearRepo(motor, boveda);

  // Sin PIN: el acceso es directo. Los datos quedan en claro en el
  // dispositivo, y eso se dice una vez en Ajustes, no en una banda que
  // molesta cada vez que abres la app.
  boveda.abrirEnClaro(haySubtle() ? 'SIN_PIN' : 'SIN_CRYPTO');

  comandos = crearComandos(repo, reloj);
  const arranque = await comandos.arrancar();
  const instantanea = await comandos.instantanea();

  estado.set({ cargando: false, ...instantanea });

  if (arranque.necesitaAlta) {
    abrirHoja({ tipo: 'alta' });
  } else if (arranque.cierres.length) {
    // Si acaba de cerrarse un mes, se enseña el informe sin que lo pidan.
    abrirHoja({ tipo: 'informe', informe: arranque.cierres[arranque.cierres.length - 1].informe });
  }

  document.addEventListener('visibilitychange', () => {
    // Al volver a primer plano puede haber cruzado la medianoche del dia 1.
    if (!document.hidden) refrescar();
  });
}

async function refrescar() {
  await comandos.asegurarPeriodos();
  const instantanea = await comandos.instantanea();
  estado.set(instantanea);
}

// =========================================================================
// Render
// =========================================================================

/** Aplica separador de miles a lo que se va tecleando. */
function formatearEntrada(digitos) {
  if (!digitos) return '0';
  const [enteros, decimales] = digitos.split(',');
  const conMiles = enteros.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return decimales !== undefined ? `${conMiles},${decimales}` : conMiles;
}

function pistaDeCaptura(s) {
  const c = s.captura;
  if (!c.digitos) return c.modo === 'ingreso' ? 'Teclea lo que entró' : 'Teclea el importe';

  if (c.modo === 'ingreso') {
    const centavos = parsearCentavos(c.digitos);
    const umbral = s.ajustes?.umbralPregunta ?? 5000;
    if (centavos > 0 && requierePreguntar(centavos, umbral)) return 'Te preguntaré cómo repartirlo';
    return 'Mitad Inversión, mitad Reserva';
  }

  if (!c.bucket) return 'Elige un techo';
  if (c.destinoTexto) return `${ETIQUETAS[c.bucket]} · ${c.destinoTexto}`;
  if (c.destinoId) {
    const d = destinosDe(s.ajustes, c.bucket).find((x) => x.id === c.destinoId);
    if (d) return `${ETIQUETAS[c.bucket]} · ${d.nombre}`;
  }
  const cat = CATEGORIAS[c.categoryId];
  return cat ? `${ETIQUETAS[c.bucket]} · ${cat.nombre}` : ETIQUETAS[c.bucket];
}

/** Vista previa del reparto de un ingreso informal, con las reglas nuevas. */
function previoIngreso(s, centavos) {
  if (!(centavos > 0) || !s.periodo) return null;
  const umbral = s.ajustes?.umbralPregunta ?? 5000;
  if (requierePreguntar(centavos, umbral)) return null;
  try {
    return distribuirInformal(centavos, s.periodo, { modo: MODO.MITADES, pesosBase: s.periodo.pesos }).partes;
  } catch {
    return null;
  }
}

function render(s) {
  if (s.cargando) {
    raiz.innerHTML = '<div class="vacio" style="margin:auto">Abriendo…</div>';
    return;
  }
  if (!s.periodo) return;

  const centavos = parsearCentavos(s.captura.digitos);
  const hayImporte = Number.isInteger(centavos) && centavos > 0;
  const esIngreso = s.captura.modo === 'ingreso';
  const listo = hayImporte && (esIngreso || Boolean(s.captura.bucket));

  raiz.innerHTML = `
    ${s.banda ? `<div class="banda ${esc(s.banda.clase)}">${esc(s.banda.texto)}</div>` : ''}
    ${cabecera(s.periodo, s)}

    <div class="zona-lectura">
      ${avisoDiagnostico(s.diagnostico)}
      ${avisoSobrante(s)}
      ${panelTechos(s.periodo, s.fecha)}
    </div>

    <div class="zona-captura">
      <div class="conmutador">
        <button data-accion="modo" data-modo="gasto" aria-pressed="${!esIngreso}">Gasto</button>
        <button data-accion="modo" data-modo="ingreso" aria-pressed="${esIngreso}">Ingreso</button>
      </div>

      ${visor(formatearEntrada(s.captura.digitos), pistaDeCaptura(s), s.captura.modo)}

      ${esIngreso
        ? previoReparto(previoIngreso(s, centavos))
        : fichasBucket(s.periodo, s.captura.bucket)}

      ${teclado()}

      <button class="confirmar" data-accion="confirmar" ${listo ? '' : 'disabled'}>
        ${esIngreso ? 'Registrar ingreso' : 'Guardar gasto'}
      </button>
    </div>`;

  capaHojas.innerHTML = s.hoja ? renderHoja(s) : '';
  capaBrindis.innerHTML = s.brindis
    ? `<div class="brindis"><span>${esc(s.brindis.texto)}</span>
         ${s.brindis.movimientoId
           ? `<button data-accion="deshacer" data-id="${esc(s.brindis.movimientoId)}">Deshacer</button>`
           : ''}</div>`
    : '';
}

function renderHoja(s) {
  const h = s.hoja;
  switch (h.tipo) {
    case 'alta':
      return hojaAlta({ moneda: s.ajustes?.moneda ?? 'R$' });
    case 'rechazo':
      return hojaRechazo({ ...h, captura: s.captura });
    case 'destinos':
      return hojaDestinos({
        bucket: h.bucket,
        ajustes: s.ajustes,
        captura: s.captura,
        importeTexto: s.captura.digitos ? `${s.ajustes?.moneda ?? 'R$'}${formatearEntrada(s.captura.digitos)}` : '',
      });
    case 'distribucion':
      return hojaDistribucion({ importeCents: h.importeCents, opciones: h.opciones });
    case 'distribucion-manual':
      return hojaDistribucionManual({ importeCents: h.importeCents, periodo: s.periodo });
    case 'sobrante':
      return hojaSobrante({
        pendiente: s.sobrantePendiente,
        sobranteActual: s.sobrante,
        historial: s.sobrantes,
        media: h.media ?? 0,
        fondos: s.fondos,
      });
    case 'detalle':
      return hojaDetalleTecho({ periodo: s.periodo, bucket: h.bucket, movimientos: s.ultimos, fecha: s.fecha });
    case 'informe':
      return hojaInforme({ informe: h.informe ?? s.ultimoInforme, periodId: s.periodo.id });
    case 'diagnostico':
      return hojaDiagnostico({ dx: s.diagnostico });
    case 'categorias':
      return hojaCategorias({ bucket: s.captura.bucket, modo: s.captura.modo });
    case 'ajustes':
      return hojaAjustes({ ajustes: s.ajustes, estadisticas: h.estadisticas, boveda });
    case 'fondos':
      return hojaFondos(h);
    default:
      return '';
  }
}

function abrirHoja(hoja) {
  estado.set({ hoja });
}

function cerrarHoja() {
  estado.set({ hoja: null });
}

function brindar(texto, movimientoId = null) {
  if (temporizadorBrindis) clearTimeout(temporizadorBrindis);
  estado.set({ brindis: { texto, movimientoId } });
  temporizadorBrindis = setTimeout(() => estado.set({ brindis: null }), 8000);
}

// =========================================================================
// Acciones
// =========================================================================

const acciones = {
  // --- teclado ---------------------------------------------------------
  digito(el, s) {
    const d = s.captura.digitos;
    const [, dec] = d.split(',');
    if (dec !== undefined && dec.length >= 2) return;
    if (d.replace(/[^\d]/g, '').length >= 12) return;
    estado.set({ captura: { ...s.captura, digitos: d + el.dataset.valor } });
  },

  coma(_el, s) {
    if (s.captura.digitos.includes(',')) return;
    const base = s.captura.digitos === '' ? '0' : s.captura.digitos;
    estado.set({ captura: { ...s.captura, digitos: `${base},` } });
  },

  borrar(_el, s) {
    estado.set({ captura: { ...s.captura, digitos: s.captura.digitos.slice(0, -1) } });
  },

  modo(el, s) {
    estado.set({ captura: { ...capturaVacia(), modo: el.dataset.modo, digitos: s.captura.digitos } });
  },

  /**
   * Elegir techo. Reserva tiene un solo destino y se asigna sola; Inversion y
   * Recompensas abren la lista; Esenciales sigue con categorias y nota libre.
   */
  'elegir-bucket'(el, s) {
    const bucket = el.dataset.bucket;
    const automatico = destinoAutomatico(s.ajustes, bucket);
    const lista = destinosDe(s.ajustes, bucket);

    if (automatico) {
      estado.set({
        captura: { ...s.captura, bucket, destinoId: automatico.id, destinoTexto: null, categoryId: null },
      });
      vibrar(8);
      return;
    }

    if (lista.length > 0) {
      estado.set({ captura: { ...s.captura, bucket, destinoId: null, destinoTexto: null, categoryId: null } });
      abrirHoja({ tipo: 'destinos', bucket });
      vibrar(8);
      return;
    }

    // Esenciales: comportamiento de siempre
    if (s.captura.bucket === bucket) {
      abrirHoja({ tipo: 'categorias' });
      return;
    }
    estado.set({ captura: { ...s.captura, bucket, categoryId: categoriaPorDefecto(bucket) } });
    vibrar(8);
  },

  'elegir-destino'(el, s) {
    const bucket = el.dataset.bucket;
    const destinoId = el.dataset.destino;
    const destino = destinosDe(s.ajustes, bucket).find((d) => d.id === destinoId);

    const captura = { ...s.captura, bucket, destinoId, destinoTexto: null };
    estado.set({ captura });

    // «Otro» se queda en la hoja para que escriban; el resto guarda ya.
    if (destino?.pideTexto) {
      abrirHoja({ tipo: 'destinos', bucket });
      setTimeout(() => capaHojas.querySelector('[data-campo="destinoTexto"]')?.focus(), 60);
      return;
    }
    cerrarHoja();
    if (parsearCentavos(captura.digitos) > 0) guardar(captura);
  },

  async 'confirmar-destino'(el, s) {
    const texto = capaHojas.querySelector('[data-campo="destinoTexto"]')?.value ?? '';
    if (!texto.trim()) {
      capaHojas.querySelector('.campo')?.classList.add('error');
      return;
    }
    const captura = { ...s.captura, bucket: el.dataset.bucket, destinoTexto: texto.trim() };
    estado.set({ captura, hoja: null });
    if (parsearCentavos(captura.digitos) > 0) await guardar(captura);
  },

  'elegir-categoria'(el, s) {
    estado.set({ captura: { ...s.captura, categoryId: el.dataset.cat }, hoja: null });
  },

  // --- confirmar -------------------------------------------------------
  async confirmar(_el, s) {
    await guardar(s.captura);
  },

  async 'aceptar-destino'(el, s) {
    await guardar({ ...s.captura, bucket: el.dataset.bucket, forzado: true });
  },

  async reintentar(_el, s) {
    await guardar(s.captura);
  },

  async 'confirmar-importe'(_el, s) {
    await guardar({ ...s.captura, confirmado: true });
  },

  async 'confirmar-con-justificacion'(_el, s) {
    const texto = capaHojas.querySelector('[data-campo="justificacion"]')?.value ?? '';
    if (texto.trim().length < 15) {
      capaHojas.querySelector('.campo')?.classList.add('error');
      return;
    }
    await guardar({ ...s.captura, justificacion: texto });
  },

  'alternar-tag'(el, s) {
    const tag = el.dataset.tag;
    const tags = s.captura.tags.includes(tag)
      ? s.captura.tags.filter((t) => t !== tag)
      : [...s.captura.tags, tag];
    estado.set({ captura: { ...s.captura, tags, nota: leerNota() } });
  },

  'alternar-campo'(el, s) {
    const campo = el.dataset.campo;
    estado.set({ captura: { ...s.captura, [campo]: !s.captura[campo], nota: leerNota() } });
  },

  async deshacer(el) {
    const r = await comandos.deshacer(el.dataset.id);
    estado.set({ brindis: null });
    if (r.ok) await refrescar();
  },

  // --- distribucion de ingresos ----------------------------------------

  async 'elegir-distribucion'(el, s) {
    const modo = el.dataset.modo;
    const importeCents = s.hoja.importeCents;

    if (modo === MODO.MANUAL) {
      abrirHoja({ tipo: 'distribucion-manual', importeCents });
      return;
    }
    cerrarHoja();
    await guardarIngreso(importeCents, { modo });
  },

  async 'elegir-bucket-ingreso'(el, s) {
    const importeCents = s.hoja.importeCents;
    cerrarHoja();
    await guardarIngreso(importeCents, { modo: MODO.MANUAL, bucketManual: el.dataset.bucket });
  },

  // --- alta -------------------------------------------------------------

  async 'guardar-alta'() {
    const texto = capaHojas.querySelector('[data-campo="altaIngreso"]')?.value ?? '';
    const centavos = parsearCentavos(texto);
    if (!(centavos > 0)) {
      capaHojas.querySelector('.campo')?.classList.add('error');
      return;
    }
    await comandos.configurarIngresoNormal(centavos);
    cerrarHoja();
    await refrescar();
    brindar(`Listo. Cada día 1 entrarán ${formatear(centavos)}.`);
  },

  async 'saltar-alta'() {
    const ajustes = await repo.ajustes();
    await repo.guardarAjustes({
      ...ajustes,
      ingresoNormal: { ...ajustes.ingresoNormal, configurado: true, montoCents: 0 },
    });
    cerrarHoja();
    await refrescar();
  },

  // --- hojas -----------------------------------------------------------
  'cerrar-hoja': cerrarHoja,

  'detalle-techo'(el) {
    abrirHoja({ tipo: 'detalle', bucket: el.dataset.bucket });
  },

  async 'ver-fondos'() {
    abrirHoja({
      tipo: 'fondos',
      fondos: await repo.fondos(),
      entradasAhorro: await repo.entradasFondo(FONDO_AHORRO, 12),
      entradasCartera: await repo.entradasFondo(CARTERA_INVERSION, 12),
    });
  },

  async 'ver-informe'(_el, s) {
    abrirHoja({ tipo: 'informe', informe: s.ultimoInforme });
  },

  async 'ver-sobrante'() {
    const { media } = await comandos.historialSobrantes();
    abrirHoja({ tipo: 'sobrante', media });
  },

  'ver-diagnostico'() {
    abrirHoja({ tipo: 'diagnostico' });
  },

  async 'ver-ajustes'() {
    abrirHoja({ tipo: 'ajustes', estadisticas: await repo.estadisticas() });
  },

  'ver-esenciales'() {
    abrirHoja({ tipo: 'detalle', bucket: 'ESENCIALES' });
  },

  // --- sobrante ---------------------------------------------------------

  async 'resolver-sobrante'(el) {
    const r = await comandos.resolverSobrante(el.dataset.periodo, el.dataset.destino);
    cerrarHoja();
    await refrescar();
    if (r.ok) {
      brindar(
        el.dataset.destino === 'NADA'
          ? 'Anotado. El sobrante queda registrado igual.'
          : `${formatear(r.registro.sobranteCents)} colocados. El historial no cambia.`,
      );
    }
  },

  // --- diagnostico -----------------------------------------------------
  async 'aplicar-propuesta'(_el, s) {
    await comandos.aplicarPropuesta(s.diagnostico.propuesta.pesosBps);
    cerrarHoja();
    await refrescar();
    brindar('Nuevo reparto aplicado desde el próximo ciclo.');
  },

  async 'posponer-diagnostico'(_el, s) {
    const ajustes = await repo.ajustes();
    await repo.guardarAjustes({ ...ajustes, diagnosticoPospuestoHasta: s.periodo.id });
    cerrarHoja();
  },

  // --- ajustes ---------------------------------------------------------

  async 'guardar-ingreso-normal'() {
    const centavos = parsearCentavos(capaHojas.querySelector('[data-campo="ingresoNormal"]')?.value ?? '');
    if (!(centavos > 0)) {
      capaHojas.querySelector('.campo')?.classList.add('error');
      return;
    }
    await comandos.configurarIngresoNormal(centavos, { aplicarYa: false });
    await refrescar();
    abrirHoja({ tipo: 'ajustes', estadisticas: await repo.estadisticas() });
    brindar(`Ingreso mensual: ${formatear(centavos)}.`);
  },

  async 'guardar-umbral'() {
    const centavos = parsearCentavos(capaHojas.querySelector('[data-campo="umbralPregunta"]')?.value ?? '');
    if (!(centavos > 0)) return;
    const ajustes = await repo.ajustes();
    await repo.guardarAjustes({ ...ajustes, umbralPregunta: centavos });
    await refrescar();
    abrirHoja({ tipo: 'ajustes', estadisticas: await repo.estadisticas() });
  },

  async 'añadir-destino'(el) {
    const nombre = prompt('Nombre del destino');
    if (!nombre?.trim()) return;
    const bucket = el.dataset.bucket;
    const ajustes = await repo.ajustes();
    const lista = [...destinosDe(ajustes, bucket)];
    lista.splice(Math.max(0, lista.length - 1), 0, {
      id: `u-${Date.now().toString(36)}`,
      nombre: nombre.trim(),
      pideTexto: false,
    });
    await repo.guardarAjustes({ ...ajustes, destinos: { ...ajustes.destinos, [bucket]: lista } });
    await refrescar();
    abrirHoja({ tipo: 'ajustes', estadisticas: await repo.estadisticas() });
  },

  async 'renombrar-destino'(el) {
    const { bucket, destino } = el.dataset;
    const ajustes = await repo.ajustes();
    const lista = destinosDe(ajustes, bucket);
    const actual = lista.find((d) => d.id === destino);
    const nombre = prompt('Nuevo nombre (vacío para borrarlo)', actual?.nombre ?? '');
    if (nombre === null) return;

    const nueva = nombre.trim()
      ? lista.map((d) => (d.id === destino ? { ...d, nombre: nombre.trim() } : d))
      : lista.filter((d) => d.id !== destino);

    await repo.guardarAjustes({ ...ajustes, destinos: { ...ajustes.destinos, [bucket]: nueva } });
    await refrescar();
    abrirHoja({ tipo: 'ajustes', estadisticas: await repo.estadisticas() });
  },

  async 'alternar-aviso'(el) {
    const clave = el.dataset.aviso;
    const ajustes = await repo.ajustes();
    const n = { ...ajustes.notificaciones, [clave]: !ajustes.notificaciones[clave] };
    await repo.guardarAjustes({ ...ajustes, notificaciones: n });
    await refrescar();
    abrirHoja({ tipo: 'ajustes', estadisticas: await repo.estadisticas() });
  },

  async exportar() {
    const datos = await repo.exportar();
    const blob = new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `finc-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  },

  async 'borrar-todo'() {
    if (!confirm('Se borra todo el historial de este dispositivo. No hay vuelta atrás. ¿Seguro?')) return;
    await repo.vaciar();
    location.reload();
  },
};

function categoriaPorDefecto(bucket) {
  const s = estado.get();
  const previos = (s.ultimos ?? []).filter((m) => m.bucket === bucket && m.categoryId);
  if (previos.length) return previos[0].categoryId;
  const cats = Object.values(CATEGORIAS).filter((c) => c.defaultBucket === bucket);
  return cats[0]?.id ?? null;
}

function leerNota() {
  return capaHojas.querySelector('[data-campo="nota"]')?.value ?? estado.get().captura.nota;
}

function vibrar(ms) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* no todos los dispositivos lo tienen */
  }
}

/** Camino unico de guardado de gastos. */
async function guardar(captura) {
  if (captura.modo === 'ingreso') {
    const centavos = parsearCentavos(captura.digitos);
    return guardarIngreso(centavos, {});
  }

  const centavos = parsearCentavos(captura.digitos);
  if (!(centavos > 0)) return;

  const nota = leerNota();
  const razon = capaHojas.querySelector('[data-campo="razonReserva"]')?.value || captura.razonReserva;

  const cmd = {
    importeCents: centavos,
    bucket: captura.bucket,
    categoryId: captura.categoryId,
    destinoId: captura.destinoId,
    destinoTexto: captura.destinoTexto,
    nota,
    tags: captura.tags,
    razonReserva: razon,
    usoProfesional: captura.usoProfesional,
    certificable: captura.certificable,
    relacionadaConIngreso: captura.relacionadaConIngreso,
    justificacion: captura.justificacion,
    comercioTipo: captura.comercioTipo,
    aceptaForzado: captura.forzado,
    confirmado: captura.confirmado,
  };

  const r = await comandos.registrarGasto(cmd);

  if (r.faltaDestino) {
    estado.set({ captura: { ...captura, nota } });
    abrirHoja({ tipo: 'destinos', bucket: r.bucket });
    return;
  }

  if (!r.ok) {
    estado.set({ captura: { ...captura, nota, razonReserva: razon } });
    abrirHoja({ tipo: 'rechazo', veredicto: r.veredicto, sugerencia: r.sugerencia, requiere: r.requiere });
    vibrar([12, 60, 12]);
    return;
  }

  vibrar(14);
  estado.set({ captura: capturaVacia(), hoja: null });
  await refrescar();

  const texto = r.aviso
    ? `${formatear(centavos)} · ${r.aviso.mensaje}`
    : r.rebasado
      ? `${formatear(centavos)} · techo rebasado`
      : `Guardado ${formatear(centavos)}`;
  brindar(texto, r.movimiento.id);
}

/** Camino unico de registro de ingresos informales. */
async function guardarIngreso(centavos, { modo, bucketManual }) {
  if (!(centavos > 0)) return;

  const r = await comandos.registrarIngreso({ importeCents: centavos, modo, bucketManual });

  if (r.requierePreguntar) {
    abrirHoja({ tipo: 'distribucion', importeCents: r.importeCents, opciones: r.opciones });
    return;
  }
  if (!r.ok) {
    brindar(r.veredicto?.mensaje ?? 'No se pudo registrar.');
    return;
  }

  vibrar(14);
  estado.set({ captura: capturaVacia(), hoja: null });
  await refrescar();

  const destinos = ORDEN.filter((b) => r.reparto[b] > 0)
    .map((b) => `${formatear(r.reparto[b])} a ${ETIQUETAS[b]}`)
    .join(' · ');
  brindar(destinos, r.movimiento.id);
}

// =========================================================================
// Delegacion de eventos
// =========================================================================

document.addEventListener('click', async (evento) => {
  const el = evento.target.closest('[data-accion]');
  if (!el) return;

  // El velo cierra la hoja; el contenido de la hoja, no.
  if (el.dataset.accion === 'cerrar-hoja' && evento.target.closest('[data-parar]') && evento.target !== el) {
    return;
  }

  const fn = acciones[el.dataset.accion];
  if (!fn) return;
  evento.preventDefault();

  try {
    await fn(el, estado.get());
  } catch (e) {
    console.error('Acción fallida:', el.dataset.accion, e);
    estado.set({ banda: { clase: 'rojo', texto: `Algo falló: ${e.message}` } });
  }
});

// Pulsacion larga sobre una ficha: abre la lista completa de destinos.
let temporizadorLargo = null;
document.addEventListener('pointerdown', (evento) => {
  const ficha = evento.target.closest('[data-accion="elegir-bucket"]');
  if (!ficha) return;
  temporizadorLargo = setTimeout(() => {
    const s = estado.get();
    const bucket = ficha.dataset.bucket;
    estado.set({ captura: { ...s.captura, bucket } });
    abrirHoja({ tipo: destinosDe(s.ajustes, bucket).length ? 'destinos' : 'categorias', bucket });
    vibrar(18);
  }, 480);
});
document.addEventListener('pointerup', () => clearTimeout(temporizadorLargo));
document.addEventListener('pointercancel', () => clearTimeout(temporizadorLargo));

// Teclado fisico, util al probar en el ordenador.
document.addEventListener('keydown', (evento) => {
  if (evento.target.matches('input, textarea, select')) return;
  const s = estado.get();
  if (/^[0-9]$/.test(evento.key)) {
    acciones.digito({ dataset: { valor: evento.key } }, s);
  } else if (evento.key === 'Backspace') {
    acciones.borrar({}, s);
  } else if (evento.key === ',' || evento.key === '.') {
    acciones.coma({}, s);
  } else if (evento.key === 'Enter') {
    raiz.querySelector('.confirmar:not([disabled])')?.click();
  } else if (evento.key === 'Escape') {
    cerrarHoja();
  }
});

estado.suscribir(render);

// Service Worker: su ausencia no puede romper la app.
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const nuevo = reg.installing;
      nuevo?.addEventListener('statechange', () => {
        if (nuevo.state === 'installed' && navigator.serviceWorker.controller) {
          estado.set({
            banda: { clase: '', texto: 'Nueva versión lista. Cierra y vuelve a abrir para actualizar.' },
          });
        }
      });
    });
  }).catch(() => {
    /* sin service worker se sigue funcionando, solo sin precarga offline */
  });
}

arrancar().catch((e) => {
  console.error(e);
  raiz.innerHTML = `<div class="vacio" style="margin:auto">No se pudo abrir el almacén.<br><small>${esc(e.message)}</small></div>`;
});

// Expuesto para el panel del archivo de prueba.
window.__auditor = {
  get estado() { return estado; },
  get repo() { return repo; },
  get comandos() { return comandos; },
  get reloj() { return reloj; },
  refrescar,
  sustituirReloj(nuevo) {
    reloj = nuevo;
    comandos = crearComandos(repo, reloj);
  },
};
