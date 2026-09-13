/**
 * Panel de pruebas del archivo `prueba.html`.
 *
 * No forma parte de la app: el empaquetador solo lo incluye en el archivo de
 * prueba. Existe porque el comportamiento interesante de esta aplicacion
 * —cierre mensual, carry-forward, diagnostico de subfinanciamiento— ocurre a
 * lo largo de MESES. Sin reloj falso y datos sembrados, probarla significaria
 * esperar a que sea 1 de octubre.
 */

import { relojFalso } from '../src/app/reloj.js';
import { formatear } from '../src/dominio/dinero.js';
import { ESENCIALES, INVERSION, RESERVA, RECOMPENSAS, ORDEN, ETIQUETAS } from '../src/dominio/buckets.js';
import { nombrePeriodo } from '../src/dominio/periodo.js';
import { MODO } from '../src/dominio/informales.js';

const u = (n) => n * 100;

function esperarApp() {
  return new Promise((resolver) => {
    const mirar = () => {
      if (window.__auditor?.comandos && window.__auditor?.repo) return resolver(window.__auditor);
      setTimeout(mirar, 60);
    };
    mirar();
  });
}

let falso = null;
let registro = [];

function anotar(texto, clase = '') {
  registro.unshift({ texto, clase, hora: new Date().toLocaleTimeString('es', { hour12: false }) });
  registro = registro.slice(0, 40);
  pintar();
}

async function conReloj(fecha) {
  const a = window.__auditor;
  falso = relojFalso(fecha, a.reloj.zona);
  a.sustituirReloj(falso);
  return a;
}

async function refrescarTodo() {
  await window.__auditor.refrescar();
  pintar();
}

// =========================================================================
// Sembrado
// =========================================================================

/**
 * Seis meses cerrados con la serie de utilizacion que dispara el diagnostico
 * critico y produce exactamente la propuesta 62/18/15/5.
 *
 * Ojo: con los pesos por defecto el techo de Esenciales ES el 50 % del
 * ingreso, asi que gastoEsencial/ingreso = utilizacion x 0,50. Las dos series
 * no son independientes, y por eso las utilizaciones van de 1,10 a 1,28.
 */
async function sembrarSeisMeses() {
  const { repo } = window.__auditor;
  const utilizaciones = [1.1, 1.24, 1.14, 1.28, 1.18, 1.2];
  const ingreso = u(1_000_000);
  const hoy = new Date();
  const base = hoy.getMonth() + 1;
  const anio = hoy.getFullYear();

  for (const [i, uso] of utilizaciones.entries()) {
    const desplazado = base - 6 + i;
    const a = anio + Math.floor((desplazado - 1) / 12);
    const m = ((desplazado - 1) % 12 + 12) % 12 + 1;
    const id = `${a}-${String(m).padStart(2, '0')}`;
    const techoEsenciales = ingreso / 2;

    await repo.guardarPeriodo({
      id,
      status: 'cerrado',
      cerradoEn: Date.now() - (6 - i) * 30 * 86_400_000,
      pesos: { ESENCIALES: 5000, INVERSION: 2500, RESERVA: 1500, RECOMPENSAS: 1000 },
      topes: {},
      ingresoTotal: ingreso,
      techos: {
        ESENCIALES: techoEsenciales,
        INVERSION: ingreso * 0.25,
        RESERVA: ingreso * 0.15,
        RECOMPENSAS: ingreso * 0.1,
      },
      totales: {
        ESENCIALES: Math.round(techoEsenciales * uso),
        INVERSION: Math.round(ingreso * 0.25 * 0.9),
        RESERVA: Math.round(ingreso * 0.15 * 0.2),
        RECOMPENSAS: Math.round(ingreso * 0.1 * 0.95),
      },
      carryIn: 0,
      carryOut: 0,
      sinRegistrar: 0,
      baseFijaAplicada: true,
    });
  }

  anotar('Sembrados 6 meses cerrados con Esenciales del 110 % al 128 %.', 'ok');
  await refrescarTodo();
}

/** Un mes en curso con datos realistas, para ver el panel con vida. */
async function sembrarMesEnCurso() {
  const { comandos } = window.__auditor;

  // El ingreso mensual normal, que es lo que llena los techos 50/25/15/10.
  await comandos.configurarIngresoNormal(u(1_240_000));

  // Gastos por tramos: importes por debajo del 25 % del techo, para no chocar
  // con R-14, y repartidos en dias para no chocar con R-15.
  const gastos = [
    [ESENCIALES, { categoryId: 'vivienda' }, u(140_000)],
    [ESENCIALES, { categoryId: 'mercado' }, u(142_000)],
    [ESENCIALES, { categoryId: 'servicios' }, u(64_000)],
    [ESENCIALES, { categoryId: 'transporte' }, u(38_000)],
    [INVERSION, { destinoId: 'cachinha' }, u(70_000)],
    [INVERSION, { destinoId: 'otro-inversion', destinoTexto: 'Tesouro Selic' }, u(60_000)],
    [RESERVA, {}, u(40_000)],
    [RECOMPENSAS, { destinoId: 'plan-hotel' }, u(28_000)],
    [RECOMPENSAS, { destinoId: 'otro-recompensa', destinoTexto: 'Cine' }, u(19_000)],
  ];

  for (const [bucket, extra, importeCents] of gastos) {
    const r = await comandos.registrarGasto({ bucket, importeCents, ...extra });
    if (!r.ok) {
      anotar(`Rechazado ${ETIQUETAS[bucket]} ${formatear(importeCents)}: ${r.veredicto?.mensaje ?? r.faltaDestino}`, 'mal');
    }
  }

  anotar('Mes en curso: ingreso normal y nueve gastos con sus destinos.', 'ok');
  await refrescarTodo();
}

// =========================================================================
// Escenarios de §15
// =========================================================================

const escenarios = {
  async 'Ingreso pequeno · R$20'() {
    const r = await window.__auditor.comandos.registrarIngreso({ importeCents: u(20) });
    if (!r.ok) { anotar('Rechazado: ' + (r.veredicto?.mensaje ?? ''), 'mal'); return; }
    anotar(`R$20 repartidos: ${ORDEN.filter((b) => r.reparto[b] > 0).map((b) => `${formatear(r.reparto[b])} a ${ETIQUETAS[b]}`).join(' + ')}`, 'ok');
    anotar('Mitad Inversion, mitad Reserva. Sin preguntar y sin centimos.', '');
    await refrescarTodo();
  },

  async 'Ingreso grande · R$70 pregunta'() {
    const r = await window.__auditor.comandos.registrarIngreso({ importeCents: u(70) });
    if (!r.requierePreguntar) { anotar('Deberia haber preguntado y no lo hizo.', 'mal'); return; }
    anotar('Pregunta antes de tocar nada. Las tres opciones:', 'ok');
    for (const o of r.opciones) {
      const detalle = o.reparto
        ? ORDEN.filter((b) => o.reparto.partes[b] > 0).map((b) => `${formatear(o.reparto.partes[b])} ${ETIQUETAS[b]}`).join(' + ')
        : 'el usuario elige el techo';
      anotar(`  ${o.titulo}: ${detalle}`, '');
    }
    const elegido = await window.__auditor.comandos.registrarIngreso({ importeCents: u(70), modo: MODO.MITADES });
    anotar(`Elegida «mitades»: ${formatear(elegido.reparto[INVERSION])} + ${formatear(elegido.reparto[RESERVA])}`, 'ok');
    await refrescarTodo();
  },

  async 'Ingreso con techo en rojo'() {
    const { comandos } = window.__auditor;
    const p = await comandos.periodoActual();
    const enRojo = ORDEN.filter((b) => (p.totales[b] ?? 0) > (p.techos[b] ?? 0));
    if (!enRojo.length) {
      anotar('Ningun techo esta en rojo: siembra un mes y pasate de Esenciales.', 'mal');
      return;
    }
    const r = await comandos.registrarIngreso({ importeCents: u(20) });
    anotar(`Ajuste: ${r.detalleReparto.ajuste}`, 'ok');
    anotar(ORDEN.filter((b) => r.reparto[b] > 0).map((b) => `${formatear(r.reparto[b])} a ${ETIQUETAS[b]}`).join(' + '), '');
    await refrescarTodo();
  },

  async 'Destinos · Reserva directa'() {
    const r = await window.__auditor.comandos.registrarGasto({ bucket: RESERVA, importeCents: u(5_000) });
    if (r.ok) anotar(`Reserva registrada en «${r.movimiento.destinoId}» sin preguntar nada.`, 'ok');
    else anotar(`Rechazado: ${r.veredicto?.mensaje ?? r.faltaDestino}`, 'mal');
    await refrescarTodo();
  },

  async 'Destinos · Inversion sin elegir'() {
    const r = await window.__auditor.comandos.registrarGasto({ bucket: INVERSION, importeCents: u(5_000) });
    if (r.faltaDestino) anotar(`Pide destino (${r.faltaDestino}): Cachinha u otro.`, 'ok');
    else anotar('Deberia haber pedido destino.', 'mal');
  },

  async 'Destinos · otro tipo sin texto'() {
    const r = await window.__auditor.comandos.registrarGasto({
      bucket: INVERSION, importeCents: u(5_000), destinoId: 'otro-inversion',
    });
    if (r.faltaDestino === 'FALTA_ESPECIFICAR') anotar(`Pide «${r.etiqueta}» antes de guardar.`, 'ok');
    else anotar('Deberia haber pedido especificar.', 'mal');
  },

  async 'Cierre del mes y sobrante'() {
    const { comandos } = window.__auditor;
    const antes = await comandos.periodoActual();
    anotar(`Saltando del ${antes.id} al dia 1 del mes siguiente...`, '');

    falso ??= relojFalso(Date.now(), window.__auditor.reloj.zona);
    window.__auditor.sustituirReloj(falso);
    falso.alDiaUnoSiguiente();

    const cierres = await window.__auditor.comandos.asegurarPeriodos();
    if (!cierres.length) { anotar('No habia nada que cerrar.', 'mal'); return; }
    for (const c of cierres) {
      anotar(`Cerrado ${nombrePeriodo(c.periodId)} · al Fondo ${formatear(c.carry.aFondo)}`, 'ok');
      anotar(`  Sobrante del mes: ${formatear(c.sobrante.sobranteCents)}`, 'ok');
    }
    await refrescarTodo();
  },

  async 'Sobrante · invertirlo'() {
    const { comandos } = window.__auditor;
    const { registros } = await comandos.historialSobrantes();
    const pendiente = registros.find((r) => !r.resueltoEn && r.sobranteCents > 0);
    if (!pendiente) { anotar('No hay sobrante pendiente. Cierra un mes primero.', 'mal'); return; }

    const antes = pendiente.sobranteCents;
    const r = await comandos.resolverSobrante(pendiente.periodId, 'INVERSION');
    anotar(`${nombrePeriodo(pendiente.periodId)}: ${formatear(antes)} a la Cartera.`, 'ok');
    anotar(`El historial sigue diciendo ${formatear(r.registro.sobranteCents)}. No cambia.`, 'ok');
    await refrescarTodo();
  },

  async 'Historial de sobrantes'() {
    const { registros, media } = await window.__auditor.comandos.historialSobrantes();
    if (!registros.length) { anotar('Todavia sin meses cerrados.', 'mal'); return; }
    for (const r of registros) {
      anotar(`${nombrePeriodo(r.periodId)}: ${formatear(r.sobranteCents)} · ${r.destino ?? 'sin decidir'}`, '');
    }
    anotar(`Media: ${formatear(media)} al mes.`, 'ok');
  },

  async 'Reglas · colar un regalo'() {
    const r = await window.__auditor.comandos.registrarGasto({
      bucket: ESENCIALES, categoryId: 'regalo', importeCents: u(4_000),
    });
    if (r.ok) anotar('Paso! Eso es un fallo.', 'mal');
    else anotar(`${r.veredicto.ruleId} lo bloqueo: «${r.veredicto.mensaje}»`, 'ok');
  },

  async 'Diagnostico de subfinanciamiento'() {
    const dx = await window.__auditor.comandos.diagnostico();
    if (!dx) { anotar('Sin diagnostico: siembra primero los 6 meses.', 'mal'); return; }
    anotar(`${dx.senal ?? dx['señal']} · ${dx.severidad} · rebasado ${dx.rebasados} de ${dx.utilizaciones.length}`, 'mal');
    anotar(dx.alerta.propuestaTexto, 'ok');
    await refrescarTodo();
  },
};

// =========================================================================
// Interfaz del panel
// =========================================================================

let abierto = false;
let contenedor;

function pintar() {
  if (!contenedor) return;
  const a = window.__auditor;
  const s = a?.estado?.get?.() ?? {};

  contenedor.innerHTML = `
    <button id="pp-toggle" title="Panel de pruebas">${abierto ? '×' : '⚗'}</button>
    ${abierto ? `
    <div id="pp-panel">
      <h3>Estado</h3>
      <div class="pp-kv">
        <span>Mes abierto</span><b>${s.periodo?.id ?? '—'}</b>
        <span>Hoy</span><b>${s.fecha ?? '—'}</b>
        <span>Reloj</span><b>${falso ? 'falso' : 'real'}</b>
        <span>Almacén</span><b>${a?.repo?.motor?.tipo ?? '—'}</b>
        <span>Cifrado</span><b>${a?.repo?.boveda?.cifra ? 'sí' : 'no'}</b>
      </div>

      ${s.periodo ? `<div class="pp-kv">
        ${ORDEN.map((b) => `<span>${ETIQUETAS[b]}</span><b>${formatear(s.periodo.totales[b])} / ${formatear(s.periodo.techos[b])}</b>`).join('')}
        <span>Fondo</span><b>${formatear(s.fondos?.FONDO_AHORRO?.saldoCents ?? 0)}</b>
      </div>` : ''}

      <h3>Reloj</h3>
      <div class="pp-fila">
        <button data-pp="dia">+1 día</button>
        <button data-pp="semana">+7 días</button>
        <button data-pp="mes">→ día 1 del mes siguiente</button>
      </div>
      <div class="pp-fila">
        <input id="pp-fecha" type="date" value="${(s.fecha ?? '').slice(0, 10)}">
        <button data-pp="fijar">Fijar fecha</button>
        <button data-pp="real">Volver al reloj real</button>
      </div>

      <h3>Sembrar</h3>
      <div class="pp-fila">
        <button data-pp="seis">6 meses que disparan el diagnóstico</button>
        <button data-pp="curso">Mes en curso con datos</button>
      </div>

      <h3>Escenarios</h3>
      <div class="pp-fila">
        ${Object.keys(escenarios).map((k) => `<button data-pp="esc" data-esc="${k}">${k}</button>`).join('')}
      </div>

      <h3>Registro</h3>
      <div id="pp-log">
        ${registro.length
          ? registro.map((r) => `<div class="pp-log-linea ${r.clase}"><span>${r.hora}</span>${r.texto}</div>`).join('')
          : '<div class="pp-log-linea" style="opacity:.5">Sin actividad todavía.</div>'}
      </div>

      <h3>Datos</h3>
      <div class="pp-fila">
        <button data-pp="volcar">Ver almacén en crudo</button>
        <button data-pp="reiniciar" class="pp-peligro">Borrar y empezar de cero</button>
      </div>
      <pre id="pp-volcado" hidden></pre>
    </div>` : ''}`;
}

async function manejar(accion, el) {
  const a = window.__auditor;

  if (accion === 'dia' || accion === 'semana' || accion === 'mes') {
    falso ??= relojFalso(a.reloj.ahora(), a.reloj.zona);
    a.sustituirReloj(falso);
    if (accion === 'dia') falso.avanzarDias(1);
    if (accion === 'semana') falso.avanzarDias(7);
    if (accion === 'mes') falso.alDiaUnoSiguiente();
    anotar(`Reloj en ${falso.fecha()}`, '');
    await refrescarTodo();
    return;
  }

  if (accion === 'fijar') {
    const valor = document.getElementById('pp-fecha')?.value;
    if (!valor) return;
    falso = relojFalso(`${valor}T09:00:00Z`, a.reloj.zona);
    a.sustituirReloj(falso);
    anotar(`Reloj fijado en ${valor}`, '');
    await refrescarTodo();
    return;
  }

  if (accion === 'real') {
    falso = null;
    location.reload();
    return;
  }

  if (accion === 'seis') return sembrarSeisMeses();
  if (accion === 'curso') return sembrarMesEnCurso();

  if (accion === 'esc') {
    const nombre = el.dataset.esc;
    anotar(`▶ ${nombre}`, '');
    await escenarios[nombre]();
    return;
  }

  if (accion === 'volcar') {
    const pre = document.getElementById('pp-volcado');
    const datos = await a.repo.exportar();
    pre.hidden = !pre.hidden;
    pre.textContent = JSON.stringify(datos, null, 1);
    return;
  }

  if (accion === 'reiniciar') {
    if (!confirm('Se borra todo lo sembrado. ¿Seguro?')) return;
    await a.repo.vaciar();
    location.reload();
  }
}

export async function montarPanel() {
  await esperarApp();

  const estilo = document.createElement('style');
  estilo.textContent = `
    #pp-raiz { position: fixed; right: 12px; bottom: 12px; z-index: 999; font-size: 13px;
      font-family: ui-monospace, Menlo, monospace; }
    #pp-toggle { width: 44px; height: 44px; border-radius: 50%; background: #2E3F86; color: #fff;
      font-size: 20px; box-shadow: 0 6px 20px -6px rgba(0,0,0,.55); margin-left: auto; display: block; }
    #pp-panel { width: min(400px, calc(100vw - 24px)); max-height: min(72vh, 640px); overflow-y: auto;
      background: #11131b; color: #e7eaf3; border-radius: 12px; padding: 14px; margin-bottom: 10px;
      box-shadow: 0 14px 44px -12px rgba(0,0,0,.7); border: 1px solid #2b3142; }
    #pp-panel h3 { font-size: 10px; text-transform: uppercase; letter-spacing: .1em; color: #79819a;
      margin: 14px 0 7px; }
    #pp-panel h3:first-child { margin-top: 0; }
    .pp-kv { display: grid; grid-template-columns: auto 1fr; gap: 3px 12px; font-size: 12px; margin-bottom: 8px; }
    .pp-kv span { color: #79819a; }
    .pp-kv b { text-align: right; font-weight: 600; }
    .pp-fila { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
    .pp-fila button { background: #1e2230; color: #e7eaf3; border: 1px solid #2b3142;
      padding: 7px 10px; border-radius: 7px; font-size: 12px; font-family: inherit; cursor: pointer; }
    .pp-fila button:hover { background: #262b3b; }
    .pp-fila button.pp-peligro { background: #3a1d19; color: #f0867a; border-color: #5a2a24; }
    .pp-fila input { background: #1e2230; color: #e7eaf3; border: 1px solid #2b3142;
      padding: 6px 8px; border-radius: 7px; font-size: 12px; font-family: inherit; }
    #pp-log { max-height: 190px; overflow-y: auto; display: grid; gap: 3px; }
    .pp-log-linea { font-size: 11.5px; line-height: 1.4; padding: 4px 7px; border-radius: 5px;
      background: #1a1d28; display: flex; gap: 8px; }
    .pp-log-linea span { color: #5a627a; flex: none; }
    .pp-log-linea.ok { color: #54c08c; }
    .pp-log-linea.mal { color: #f0867a; }
    #pp-volcado { max-height: 240px; overflow: auto; background: #0b0d13; padding: 9px;
      border-radius: 7px; font-size: 10.5px; line-height: 1.4; margin: 6px 0 0; }
  `;
  document.head.appendChild(estilo);

  contenedor = document.createElement('div');
  contenedor.id = 'pp-raiz';
  document.body.appendChild(contenedor);

  contenedor.addEventListener('click', async (evento) => {
    const boton = evento.target.closest('button');
    if (!boton) return;
    evento.stopPropagation();

    if (boton.id === 'pp-toggle') {
      abierto = !abierto;
      pintar();
      return;
    }
    if (boton.dataset.pp) {
      try {
        await manejar(boton.dataset.pp, boton);
      } catch (e) {
        anotar(`Error: ${e.message}`, 'mal');
        console.error(e);
      }
    }
  });

  window.__auditor.estado.suscribir(() => {
    if (abierto) pintar();
  });

  pintar();
  anotar('Panel listo. Empieza sembrando datos.', 'ok');
}

montarPanel();
