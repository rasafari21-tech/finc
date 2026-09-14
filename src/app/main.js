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
import { previoDeSeleccion, limpiarSeleccion } from '../dominio/informales.js';

import {
  cabecera, panelTechos, teclado, fichasBucket, fichasIngreso,
  visor, avisoDiagnostico, avisoSobrante, esc,
} from '../ui/componentes.js';
import {
  hojaRechazo, hojaDetalleTecho, hojaInforme, hojaDiagnostico, hojaCategorias,
  hojaAjustes, hojaFondos, hojaAlta, hojaDestinos, hojaSobrante,
  hojaMovimiento, hojaImportar, hojaDetalles, hojaHistorial, hojaIntro,
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
  const cierres = await comandos.asegurarPeriodos();
  const instantanea = await comandos.instantanea();
  estado.set(instantanea);

  // La compactacion va DESPUES del cierre y sin bloquear el render: el cierre
  // tiene que terminar en milisegundos, comprimir dos años de historia no.
  if (cierres.length) {
    setTimeout(() => {
      comandos.compactarMesesFrios().catch((e) => console.warn('compactación:', e?.message));
    }, 2_000);
  }
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
    const n = limpiarSeleccion(c.bucketsIngreso).length;
    if (n === 1) return 'Va entero al techo marcado';
    return `Se divide entre los ${n} techos marcados`;
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

/** Cuanto tocaria a cada techo marcado con lo que hay tecleado ahora mismo. */
function previoIngreso(s, centavos) {
  if (!s.periodo) return null;
  return previoDeSeleccion(centavos, s.periodo, limpiarSeleccion(s.captura.bucketsIngreso));
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

      ${visor(formatearEntrada(s.captura.digitos), pistaDeCaptura(s), s.captura.modo,
              s.ajustes?.moneda, !esIngreso, s.captura)}

      ${esIngreso
        ? fichasIngreso(limpiarSeleccion(s.captura.bucketsIngreso), previoIngreso(s, centavos))
        : fichasBucket(s.periodo, s.captura.bucket)}

      ${teclado()}

      <button class="confirmar" data-accion="confirmar" ${listo ? '' : 'disabled'}>
        ${esIngreso ? 'Registrar ingreso' : 'Guardar gasto'}
      </button>
    </div>`;

  capaHojas.innerHTML = s.hoja ? renderHoja(s) : '';
  sincronizarFoco(s.hoja?.tipo ?? null);
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
    case 'intro':
      return hojaIntro({
        paso: h.paso ?? 0,
        ingresoNormal: s.ajustes?.ingresoNormal?.montoCents ?? 0,
        pesos: s.ajustes?.pesos,
      });
    case 'historial':
      return hojaHistorial({ datos: h.datos, meses: h.meses, ajustes: s.ajustes });
    case 'movimiento':
      return hojaMovimiento({ ...h, ajustes: s.ajustes });
    case 'importar':
      return hojaImportar({ analisis: h.analisis, error: h.error });
    case 'detalles':
      return hojaDetalles({ captura: s.captura, periodo: s.periodo, fechaHoy: s.fecha });
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
      return hojaInforme({
        informe: h.informe ?? s.ultimoInforme,
        periodId: s.periodo.id,
        disponibles: h.disponibles ?? [],
      });
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

/**
 * Foco de las hojas.
 *
 * Al abrir una hoja el foco tiene que entrar en ella, y al cerrarla volver a
 * donde estaba. Sin esto, quien navegue con teclado o VoiceOver abre una hoja
 * y sigue con el foco detras, tabulando por una pantalla que ya no ve.
 *
 * El enfoque ocurre solo cuando CAMBIA la hoja, no en cada repintado: la hoja
 * se vuelve a dibujar con cada cambio de estado, y robar el foco cada vez
 * expulsaria al usuario del campo que esta escribiendo.
 */
let focoPrevio = null;
let tipoHojaVisible = null;

function abrirHoja(hoja) {
  if (!estado.get().hoja) focoPrevio = document.activeElement;
  estado.set({ hoja });
}

function cerrarHoja() {
  correccionPendiente = null;
  estado.set({ hoja: null });
  if (focoPrevio?.isConnected) focoPrevio.focus();
  focoPrevio = null;
}

const ENFOCABLES = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function enfocables() {
  const hoja = capaHojas.querySelector('.hoja');
  return hoja ? [...hoja.querySelectorAll(ENFOCABLES)].filter((e) => !e.disabled) : [];
}

function sincronizarFoco(tipo) {
  if (tipo === tipoHojaVisible) return;
  tipoHojaVisible = tipo;
  if (!tipo) return;

  const hoja = capaHojas.querySelector('.hoja');
  if (!hoja) return;
  // Si la hoja pide escribir algo, el foco va al campo; si no, al contenedor,
  // que es lo que hace que el lector de pantalla lea el titulo.
  const campo = hoja.querySelector('input, textarea, select');
  (campo ?? hoja).focus({ preventScroll: true });
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
    estado.set({
      captura: {
        ...capturaVacia(),
        modo: el.dataset.modo,
        digitos: s.captura.digitos,
        bucketsIngreso: s.captura.bucketsIngreso,
      },
    });
  },

  /** Marca o desmarca un techo para el ingreso. Nunca se queda sin ninguno. */
  'alternar-ingreso'(el, s) {
    const b = el.dataset.bucket;
    const actual = limpiarSeleccion(s.captura.bucketsIngreso);
    const siguiente = actual.includes(b) ? actual.filter((x) => x !== b) : [...actual, b];
    if (!siguiente.length) return; // desmarcar el ultimo no hace nada
    estado.set({ captura: { ...s.captura, bucketsIngreso: siguiente } });
    destellarPulsado(el);
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
      return;
    }

    if (lista.length > 0) {
      estado.set({ captura: { ...s.captura, bucket, destinoId: null, destinoTexto: null, categoryId: null } });
      abrirHoja({ tipo: 'destinos', bucket });
      return;
    }

    // Esenciales: comportamiento de siempre
    if (s.captura.bucket === bucket) {
      abrirHoja({ tipo: 'categorias' });
      return;
    }
    estado.set({ captura: { ...s.captura, bucket, categoryId: categoriaPorDefecto(bucket) } });
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
    if (correccionPendiente) {
      const { id, importeCents } = correccionPendiente;
      correccionPendiente = null;
      const r = await comandos.editarMovimiento(id, { importeCents, confirmado: true });
      cerrarHoja();
      if (!r.ok) { brindar('No se pudo corregir.'); return; }
      await refrescar();
      brindar(`Corregido a ${formatear(importeCents)}.`);
      return;
    }
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

  // --- detalles opcionales del registro (UX-04, UX-05) -----------------

  'ver-detalles'() {
    abrirHoja({ tipo: 'detalles' });
  },

  'guardar-detalles'(_el, s) {
    const nota = capaHojas.querySelector('[data-campo="nota"]')?.value ?? '';
    const fecha = capaHojas.querySelector('[data-campo="fecha"]')?.value || null;
    estado.set({ captura: { ...s.captura, nota: nota.trim(), localDate: fecha } });
    cerrarHoja();
  },

  'limpiar-detalles'(_el, s) {
    estado.set({ captura: { ...s.captura, nota: '', localDate: null } });
    cerrarHoja();
  },

  // --- corregir un movimiento (UX-01) -----------------------------------

  async 'ver-movimiento'(el) {
    const encontrado = await comandos.movimiento(el.dataset.id);
    if (!encontrado) return;
    abrirHoja({ tipo: 'movimiento', ...encontrado });
  },

  async 'guardar-correccion'(el, s) {
    const texto = capaHojas.querySelector('[data-campo="nuevoImporte"]')?.value ?? '';
    const centavos = parsearCentavos(texto);
    if (!(centavos > 0)) {
      capaHojas.querySelector('.campo')?.classList.add('error');
      return;
    }
    const r = await comandos.editarMovimiento(el.dataset.id, { importeCents: centavos });
    if (!r.ok) {
      if (r.veredicto) {
        // Si la correccion trae otro importe raro, se pregunta igual que en un
        // registro nuevo, y al confirmar se retoma por donde iba.
        correccionPendiente = { id: el.dataset.id, importeCents: centavos };
        abrirHoja({ tipo: 'rechazo', veredicto: r.veredicto, requiere: r.requiere });
      } else {
        brindar('No se pudo corregir.');
      }
      return;
    }
    correccionPendiente = null;
    cerrarHoja();
    await refrescar();
    brindar(`Corregido a ${formatear(centavos)}.`);
  },

  async 'anular-movimiento'(el) {
    const r = await comandos.anularMovimiento(el.dataset.id);
    cerrarHoja();
    if (!r.ok) { brindar('No se pudo anular.'); return; }
    await refrescar();
    brindar('Movimiento anulado.');
  },

  async 'corregir-en-abierto'(el, s) {
    const encontrado = await comandos.movimiento(el.dataset.id);
    cerrarHoja();
    if (!encontrado) return;
    const m = encontrado.movimiento;
    estado.set({
      captura: {
        ...capturaVacia(),
        modo: m.tipo === 'ingreso' ? 'ingreso' : 'gasto',
        bucket: m.bucket,
        categoryId: m.categoryId,
        destinoId: m.destinoId,
        destinoTexto: m.destinoTexto,
        nota: `Corrección de ${m.localDate}`,
      },
    });
    brindar('Teclea el importe de la corrección.');
  },

  // --- restaurar una copia (UX-03) --------------------------------------

  'ver-importar'() {
    abrirHoja({ tipo: 'importar' });
  },

  'elegir-copia'() {
    const entrada = document.createElement('input');
    entrada.type = 'file';
    entrada.accept = 'application/json,.json';
    entrada.addEventListener('change', async () => {
      const archivo = entrada.files?.[0];
      if (!archivo) return;
      try {
        const datos = JSON.parse(await archivo.text());
        const analisis = await comandos.analizarCopia(datos);
        if (!analisis.valido) {
          abrirHoja({ tipo: 'importar', error: analisis.motivo });
          return;
        }
        copiaPendiente = datos;
        abrirHoja({ tipo: 'importar', analisis });
      } catch (e) {
        abrirHoja({ tipo: 'importar', error: 'No es un archivo JSON válido.' });
      }
    });
    entrada.click();
  },

  async 'confirmar-restauracion'() {
    if (!copiaPendiente) return;
    const r = await comandos.restaurarCopia(copiaPendiente);
    copiaPendiente = null;
    cerrarHoja();
    if (!r.ok) { brindar(r.motivo ?? 'No se pudo restaurar.'); return; }
    await refrescar();
    brindar(`Restaurados ${r.resumen.movimientos} movimientos de ${r.resumen.periodos} meses.`);
  },

  async deshacer(el) {
    const r = await comandos.deshacer(el.dataset.id);
    estado.set({ brindis: null });
    if (r.ok) await refrescar();
  },

  // --- distribucion de ingresos ----------------------------------------

  // --- alta -------------------------------------------------------------

  async 'guardar-alta'() {
    const texto = capaHojas.querySelector('[data-campo="altaIngreso"]')?.value ?? '';
    const centavos = parsearCentavos(texto);
    if (!(centavos > 0)) {
      capaHojas.querySelector('.campo')?.classList.add('error');
      return;
    }
    await comandos.configurarIngresoNormal(centavos);
    await refrescar();
    abrirHoja({ tipo: 'intro', paso: 0 });
  },

  async 'saltar-alta'() {
    const ajustes = await repo.ajustes();
    await repo.guardarAjustes({
      ...ajustes,
      ingresoNormal: { ...ajustes.ingresoNormal, configurado: true, montoCents: 0 },
    });
    await refrescar();
    abrirHoja({ tipo: 'intro', paso: 0 });
  },

  // --- introduccion (UX-10) ---------------------------------------------

  'ver-intro'() {
    abrirHoja({ tipo: 'intro', paso: 0 });
  },

  async 'intro-siguiente'(el) {
    const paso = Number(el.dataset.paso);
    if (paso >= 3) { cerrarHoja(); await refrescar(); return; }
    abrirHoja({ tipo: 'intro', paso });
  },

  'intro-saltar'() {
    cerrarHoja();
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

  // --- historial (UX-02) e informes por mes (UX-12) ---------------------

  async 'ver-historial'(_el, s) {
    await mostrarHistorial({ periodId: s.periodo.id });
  },

  async 'filtrar-techo'(el, s) {
    const f = s.hoja?.datos?.filtro ?? {};
    await mostrarHistorial({
      periodId: s.hoja.datos.periodId,
      bucket: el.dataset.bucket || null,
      texto: capaHojas.querySelector('[data-campo="buscaHistorial"]')?.value ?? f.texto ?? '',
    });
  },

  async 'ver-informe'(_el, s) {
    const disponibles = (await repo.informes()).map((i) => i.periodId);
    abrirHoja({ tipo: 'informe', informe: s.ultimoInforme, disponibles });
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

/** Abre o refresca el historial conservando el filtro. */
async function mostrarHistorial(filtro) {
  const datos = await comandos.historial(filtro);
  const meses = await comandos.mesesDisponibles();
  abrirHoja({ tipo: 'historial', datos, meses });
}

/** Copia a la espera de confirmacion en la hoja de restaurar. */
let copiaPendiente = null;

/** Correccion frenada por una regla, a la espera de que se confirme. */
let correccionPendiente = null;

/**
 * Acuse de recibo visual.
 *
 * Aqui habia nueve llamadas a navigator.vibrate(). Safari en iOS no implementa
 * esa API: no vibraba nada y nunca lo hizo. La confirmacion al tocar si aporta;
 * lo que fallaba era el canal. Un destello corto sobre el propio elemento
 * llega siempre y respeta prefers-reduced-motion desde el CSS.
 */
function destellar(el) {
  if (!el) return;
  el.classList.remove('destello');
  void el.offsetWidth; // fuerza reinicio de la animacion si se repite rapido
  el.classList.add('destello');
  setTimeout(() => el.classList.remove('destello'), 320);
}

/** Destella el boton que se acaba de pulsar, sea cual sea. */
function destellarPulsado(el) {
  destellar(el);
}

/** Camino unico de guardado de gastos. */
async function guardar(captura) {
  if (captura.modo === 'ingreso') {
    return guardarIngreso(parsearCentavos(captura.digitos), captura.bucketsIngreso);
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
    localDate: captura.localDate ?? undefined,
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
    return;
  }
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
async function guardarIngreso(centavos, buckets) {
  if (!(centavos > 0)) return;

  const r = await comandos.registrarIngreso({ importeCents: centavos, buckets });

  if (!r.ok) {
    brindar(r.veredicto?.mensaje ?? 'No se pudo registrar.');
    return;
  }
  estado.set({
    captura: { ...capturaVacia(), modo: 'ingreso', bucketsIngreso: limpiarSeleccion(buckets) },
    hoja: null,
  });
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

// Trampa de tabulador: con una hoja abierta, el foco no se va por detras.
document.addEventListener('keydown', (evento) => {
  if (evento.key !== 'Tab' || !estado.get().hoja) return;
  const lista = enfocables();
  if (!lista.length) return;

  const primero = lista[0];
  const ultimo = lista[lista.length - 1];
  const dentro = capaHojas.contains(document.activeElement);

  if (!dentro) {
    evento.preventDefault();
    (evento.shiftKey ? ultimo : primero).focus();
  } else if (evento.shiftKey && document.activeElement === primero) {
    evento.preventDefault();
    ultimo.focus();
  } else if (!evento.shiftKey && document.activeElement === ultimo) {
    evento.preventDefault();
    primero.focus();
  }
});

// Los selectores y el buscador de las hojas viven fuera de la delegacion por
// click: escuchan cambios y entrada de texto sobre la capa de hojas.
capaHojas.addEventListener('change', async (evento) => {
  const campo = evento.target.dataset?.campo;
  if (campo === 'mesHistorial') {
    const s = estado.get();
    await mostrarHistorial({
      periodId: evento.target.value,
      bucket: s.hoja?.datos?.filtro?.bucket ?? null,
      texto: capaHojas.querySelector('[data-campo="buscaHistorial"]')?.value ?? '',
    });
  } else if (campo === 'mesInforme') {
    const informe = await repo.informe(evento.target.value);
    const disponibles = (await repo.informes()).map((i) => i.periodId);
    abrirHoja({ tipo: 'informe', informe, disponibles });
  }
});

let tecleoHistorial = null;
capaHojas.addEventListener('input', (evento) => {
  if (evento.target.dataset?.campo !== 'buscaHistorial') return;
  clearTimeout(tecleoHistorial);
  const texto = evento.target.value;
  // Se espera a que pare de teclear: repintar en cada letra pierde el foco.
  tecleoHistorial = setTimeout(async () => {
    const s = estado.get();
    await mostrarHistorial({
      periodId: s.hoja?.datos?.periodId,
      bucket: s.hoja?.datos?.filtro?.bucket ?? null,
      texto,
    });
    capaHojas.querySelector('[data-campo="buscaHistorial"]')?.focus();
  }, 320);
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
