/**
 * Hojas inferiores: rechazo, detalle de techo, informe, anclaje, ajustes.
 *
 * Todas devuelven HTML. La hoja de rechazo (§7.3) es la mas importante de
 * todas: es donde el motor inflexible se gana o se pierde al usuario.
 */

import { esc, formatear, ETIQUETAS, ORDEN, filaMovimiento } from './componentes.js';
import { margen, proyeccion, nombrePeriodo, diasEnPeriodo, diaDeFecha } from '../dominio/periodo.js';
import { RAZONES_RESERVA, POR_ID as CATEGORIAS, deBucket, deIngreso } from '../dominio/categorias.js';
import { destinosDe } from '../dominio/destinos.js';
import { DESTINOS_SOBRANTE, ordenarHistorial } from '../dominio/sobrante.js';
import { MODO } from '../dominio/informales.js';
import { REGLAS_NUCLEO } from '../dominio/reglas.js';
import { etiquetaDestino } from '../dominio/carry.js';
import { porcentaje } from '../dominio/dinero.js';

const envolver = (contenido) => `<div class="velo" data-accion="cerrar-hoja"><div class="hoja" data-parar>
  <div class="asa"></div>${contenido}</div></div>`;

/**
 * Hoja de rechazo. Nunca es un aviso que se desvanece: el usuario debe
 * entender que regla actuo y cual es la salida correcta.
 */
export function hojaRechazo({ veredicto, sugerencia, requiere, captura }) {
  const destino = sugerencia?.bucket ?? veredicto.bucketDestino;

  const requisitos = veredicto.requisitos?.length
    ? `<h3>Qué necesito</h3><ul style="margin:0 0 14px;padding-left:20px;font-size:14px;color:var(--tinta-2)">
         ${veredicto.requisitos.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`
    : '';

  const explicacion = veredicto.explicacion?.length
    ? `<p style="font-size:12.5px;color:var(--tinta-3)">Se cumplió que ${esc(veredicto.explicacion.join(', y que '))}.</p>`
    : '';

  const chip = destino
    ? `<div class="sugerencia">
         <span>→ ${esc(ETIQUETAS[destino] ?? destino)}</span>
       </div>`
    : '';

  let acciones = '';
  if (veredicto.tipo === 'FORCE' && destino) {
    acciones = `
      <button class="btn principal" data-accion="aceptar-destino" data-bucket="${destino}">
        Guardar en ${esc(ETIQUETAS[destino])}
      </button>
      <button class="btn" data-accion="cerrar-hoja">Cambiar categoría</button>`;
  } else if (requiere === 'evidencia') {
    acciones = `
      <div class="campo">
        <label for="nota-evidencia">Explica por qué</label>
        <textarea id="nota-evidencia" data-campo="nota" placeholder="Una frase basta">${esc(captura?.nota ?? '')}</textarea>
      </div>
      ${etiquetasSugeridas(veredicto, captura)}
      ${veredicto.ruleId === 'R-06' ? interruptorCampo('usoProfesional', 'Es de uso profesional', captura) : ''}
      ${veredicto.ruleId === 'R-10' ? interruptorCampo('certificable', 'Da una certificación', captura) : ''}
      ${veredicto.ruleId === 'R-10' ? interruptorCampo('relacionadaConIngreso', 'Se relaciona con mi trabajo', captura) : ''}
      <button class="btn principal" data-accion="reintentar">Volver a intentar</button>
      ${destino ? `<button class="btn" data-accion="aceptar-destino" data-bucket="${destino}">Guardar en ${esc(ETIQUETAS[destino])}</button>` : ''}`;
  } else if (requiere === 'confirmacion') {
    // Un si o un no. Sin campo de texto: no se justifica, se confirma.
    acciones = `
      <button class="btn principal" data-accion="confirmar-importe">Sí, es correcto</button>
      <button class="btn" data-accion="cerrar-hoja">Lo corrijo</button>`;
  } else if (requiere === 'justificacion') {
    acciones = `
      <div class="campo">
        <label for="just">Justificación (15 caracteres como mínimo)</label>
        <textarea id="just" data-campo="justificacion" placeholder="¿Qué fue exactamente?"></textarea>
        <span class="ayuda">Quedará señalado en el informe del mes.</span>
      </div>
      <button class="btn principal" data-accion="confirmar-con-justificacion">Guardar igual</button>
      <button class="btn" data-accion="cerrar-hoja">Mejor no</button>`;
  } else if (veredicto.ruleId === 'R-08') {
    acciones = `
      <div class="campo">
        <label for="razon">Motivo de la retirada</label>
        <select id="razon" data-campo="razonReserva">
          <option value="">Elige uno…</option>
          ${RAZONES_RESERVA.map((r) => `<option value="${r.id}">${esc(r.nombre)}</option>`).join('')}
        </select>
      </div>
      <button class="btn principal" data-accion="reintentar">Continuar</button>
      <button class="btn" data-accion="cerrar-hoja">Cancelar</button>`;
  } else {
    acciones = `<button class="btn principal" data-accion="cerrar-hoja">Entendido</button>`;
  }

  return envolver(`
    <h2>${esc(veredicto.mensaje)}</h2>
    <p class="destacado">${esc(veredicto.porque)}</p>
    ${explicacion}
    ${requisitos}
    ${chip}
    <div class="botones">${acciones}</div>
    ${requiere === 'confirmacion'
      ? ''
      : `<p style="font-size:11.5px;color:var(--tinta-3);text-align:center;margin:14px 0 0">
           Regla ${esc(veredicto.ruleId ?? '—')}${veredicto.anulable ? '' : ' · no se puede desactivar'}
         </p>`}`);
}

function etiquetasSugeridas(veredicto, captura) {
  const porRegla = {
    'R-04': ['viaje-laboral'],
    'R-03': ['viaje-laboral'],
    'R-07': ['uniforme', 'epp', 'calzado-seguridad'],
    'R-09': ['prescripcion-medica'],
    'R-13': ['viaje-laboral'],
  };
  const tags = porRegla[veredicto.ruleId];
  if (!tags) return '';
  return `
    <div class="campo">
      <label>Etiquetas</label>
      <div class="etiquetas">
        ${tags
          .map(
            (t) =>
              `<button data-accion="alternar-tag" data-tag="${t}" aria-pressed="${(captura?.tags ?? []).includes(t)}">${esc(t.replace(/-/g, ' '))}</button>`,
          )
          .join('')}
      </div>
    </div>`;
}

function interruptorCampo(campo, texto, captura) {
  return `
    <div class="interruptor">
      <span class="txt">${esc(texto)}</span>
      <button class="palanca" data-accion="alternar-campo" data-campo="${campo}"
              aria-pressed="${Boolean(captura?.[campo])}" aria-label="${esc(texto)}"></button>
    </div>`;
}

/** Detalle de un techo al tocar su barra. */
export function hojaDetalleTecho({ periodo, bucket, movimientos, fecha }) {
  const techo = periodo.techos[bucket] ?? 0;
  const gastado = periodo.totales[bucket] ?? 0;
  const restante = margen(periodo, bucket);
  const proy = proyeccion(periodo, bucket, fecha);

  // Lo mismo que dice la marca vertical de la barra, pero con palabras.
  const dia = diaDeFecha(fecha);
  const dias = diasEnPeriodo(periodo.id);
  const delMes = dia / dias;
  const delTecho = techo > 0 ? gastado / techo : 0;
  const adelantado = delTecho > delMes;
  const delBucket = movimientos.filter((m) => m.bucket === bucket).slice(0, 10);

  const porCategoria = {};
  for (const m of movimientos.filter((x) => x.bucket === bucket)) {
    porCategoria[m.categoryId] = (porCategoria[m.categoryId] ?? 0) + m.importeCents;
  }
  const top = Object.entries(porCategoria).sort((a, b) => b[1] - a[1]).slice(0, 5);

  return envolver(`
    <h2>${esc(ETIQUETAS[bucket])}</h2>
    <div class="lista">
      <div class="fila"><span class="t">Techo del mes</span><span class="v">${formatear(techo)}</span></div>
      <div class="fila"><span class="t">Gastado</span><span class="v">${formatear(gastado)} <small style="color:var(--tinta-3)">${porcentaje(gastado, techo)} %</small></span></div>
      <div class="fila"><span class="t">${restante < 0 ? 'Rebasado en' : 'Queda'}</span>
        <span class="v ${restante < 0 ? 'neg' : 'pos'}">${formatear(Math.abs(restante))}</span></div>
      <div class="fila"><span class="t">Proyección a fin de mes</span>
        <span class="v ${proy > techo ? 'neg' : ''}">${formatear(proy)}</span>
        <span class="s">al ritmo actual de gasto</span></div>
      <div class="fila"><span class="t">Ritmo</span>
        <span class="v ${adelantado ? 'neg' : 'pos'}">${Math.round(delTecho * 100)} % vs ${Math.round(delMes * 100)} %</span>
        <span class="s">llevas gastado frente al mes transcurrido ·
          ${adelantado ? 'vas por delante, ojo' : 'vas por detrás, bien'}</span></div>
    </div>
    <p style="font-size:12.5px;margin-top:10px">
      La línea vertical de cada barra marca esto mismo: por dónde va el mes.
      Hoy es el día ${dia} de ${dias}. Si la barra pasa la marca, gastas más
      rápido de lo que corre el calendario.
    </p>

    ${top.length ? `<h3>Por categoría</h3><div class="lista">${top
      .map(
        ([id, cents]) =>
          `<div class="fila"><span class="t">${esc(CATEGORIAS[id]?.nombre ?? id ?? 'Sin categoría')}</span><span class="v">${formatear(cents)}</span></div>`,
      )
      .join('')}</div>` : ''}

    ${delBucket.length
      ? `<h3>Últimos movimientos</h3><div class="lista">${delBucket.map((m) => filaMovimiento(m, CATEGORIAS)).join('')}</div>`
      : '<p class="vacio">Todavía no hay movimientos en este techo.</p>'}

    <div class="botones"><button class="btn" data-accion="cerrar-hoja">Cerrar</button></div>`);
}

/** Informe de cierre archivado. */
export function hojaInforme({ informe, periodId }) {
  if (!informe) {
    return envolver(`
      <h2>Aún no hay informes</h2>
      <p>El primero se genera automáticamente cuando termine el mes en curso. No tienes que hacer nada.</p>
      <div class="botones"><button class="btn" data-accion="cerrar-hoja">Entendido</button></div>`);
  }

  const buckets = informe.porBucket
    .map((b) => {
      const rebasado = b.excesoCents > 0;
      return `<div class="fila">
        <span class="t">${esc(ETIQUETAS[b.bucket])}</span>
        <span class="v ${rebasado ? 'neg' : ''}">${Math.round(b.utilizacion * 100)} %</span>
        <span class="s">${formatear(b.gastado)} de ${formatear(b.techo)} · ${
          rebasado
            ? `rebasado en ${formatear(b.excesoCents)}`
            : b.remanenteCents > 0
              ? `${formatear(b.remanenteCents)} → ${esc(etiquetaDestino(b.destinoRemanente))}`
              : 'sin remanente'
        }</span>
      </div>`;
    })
    .join('');

  const cobros = informe.cobrosIncompletos?.length
    ? `<h3>Cobros a medias</h3><div class="lista">${informe.cobrosIncompletos
        .map(
          (c) =>
            `<div class="fila"><span class="t">${esc(c.grupo)}</span><span class="v neg">${formatear(c.pendiente)}</span><span class="s">pendiente de ${formatear(c.pactado)}</span></div>`,
        )
        .join('')}</div>`
    : '';

  const reglas = Object.entries(informe.reglas?.porRegla ?? {});
  const choques = reglas.length
    ? `<h3>Choques con las reglas</h3><div class="lista">${reglas
        .map(([id, n]) => {
          const r = REGLAS_NUCLEO.find((x) => x.id === id);
          return `<div class="fila"><span class="t">${esc(r?.mensaje ?? id)}</span><span class="v">${n}×</span><span class="s">${esc(id)}</span></div>`;
        })
        .join('')}</div>`
    : '';

  return envolver(`
    <h2>${esc(nombrePeriodo(informe.periodId ?? periodId))}</h2>
    <div class="lista">
      <div class="fila"><span class="t">Ingresado</span><span class="v pos">${formatear(informe.ingresoTotal)}</span></div>
      <div class="fila"><span class="t">Gastado</span><span class="v">${formatear(informe.gastoTotal)}</span></div>
      <div class="fila"><span class="t">Al Fondo de Ahorro</span><span class="v pos">${formatear(informe.carry.aFondo)}</span>
        <span class="s">remanente de Reserva</span></div>
      ${informe.carry.aCartera > 0 ? `<div class="fila"><span class="t">A la Cartera</span><span class="v pos">${formatear(informe.carry.aCartera)}</span></div>` : ''}
      ${informe.carry.expirado > 0 ? `<div class="fila"><span class="t">Expirado</span><span class="v">${formatear(informe.carry.expirado)}</span><span class="s">no se arrastra al mes siguiente</span></div>` : ''}
      ${informe.sobranteCents > 0 ? `<div class="fila"><span class="t">Te sobró</span><span class="v pos">${formatear(informe.sobranteCents)}</span>
        <span class="s">de Esenciales y Recompensas, libre para invertir o reservar</span></div>` : ''}
    </div>

    <h3>Techos</h3>
    <div class="lista">${buckets}</div>
    ${cobros}
    ${choques}

    <div class="botones"><button class="btn" data-accion="cerrar-hoja">Cerrar</button></div>`);
}

/** Propuesta del diagnostico de subfinanciamiento. */
export function hojaDiagnostico({ dx }) {
  const a = dx.alerta;
  const p = dx.propuesta;

  const tabla = p?.viable
    ? `<div class="lista">${ORDEN.map((b) => {
        const antes = p.actual[b];
        const despues = p.propuesto[b];
        const delta = despues - antes;
        return `<div class="fila">
          <span class="t">${esc(ETIQUETAS[b])}</span>
          <span class="v ${delta > 0 ? 'pos' : delta < 0 ? 'neg' : ''}">${antes} % → ${despues} %</span>
          ${delta !== 0 ? `<span class="s">${delta > 0 ? '+' : ''}${delta} puntos</span>` : '<span class="s">sin cambios</span>'}
        </div>`;
      }).join('')}</div>`
    : '';

  const serie = dx.utilizaciones.map((u) => `${Math.round(u * 100)} %`).join(' · ');

  return envolver(`
    <h2>${esc(a.titular)}</h2>
    <p class="destacado">${esc(a.evidencia)}</p>
    <p style="font-family:ui-monospace,monospace;font-size:13px">${esc(serie)}</p>
    <p>${esc(a.diagnostico)}</p>
    ${tabla}
    <div class="botones">
      ${p?.viable
        ? `<button class="btn principal" data-accion="aplicar-propuesta">${esc(a.accionPrimaria)}</button>`
        : ''}
      <button class="btn" data-accion="ver-esenciales">Ver mis Esenciales</button>
      <button class="btn" data-accion="posponer-diagnostico">Ahora no</button>
    </div>
    <p style="font-size:11.5px;color:var(--tinta-3);text-align:center;margin:14px 0 0">
      Nada cambia hasta que lo apruebes. Quedará anotado en la bitácora.
    </p>`);
}

/** Selector de categoria, que aparece tras elegir techo si hace falta. */
export function hojaCategorias({ bucket, modo }) {
  const cats = modo === 'ingreso' ? deIngreso() : deBucket(bucket);
  const otras = modo === 'ingreso' ? [] : Object.values(CATEGORIAS).filter((c) => c.defaultBucket && c.defaultBucket !== bucket);

  return envolver(`
    <h2>¿Qué fue?</h2>
    <div class="etiquetas" style="margin-bottom:18px">
      ${cats.map((c) => `<button data-accion="elegir-categoria" data-cat="${c.id}">${esc(c.nombre)}</button>`).join('')}
    </div>
    ${otras.length
      ? `<h3>Otras categorías</h3>
         <p style="font-size:12.5px">Si eliges una de aquí, puede que una regla la reubique.</p>
         <div class="etiquetas">
           ${otras.map((c) => `<button data-accion="elegir-categoria" data-cat="${c.id}">${esc(c.nombre)}</button>`).join('')}
         </div>`
      : ''}
    <div class="botones"><button class="btn" data-accion="cerrar-hoja">Cancelar</button></div>`);
}

/** Ajustes. */
export function hojaAjustes({ ajustes, estadisticas, boveda }) {
  const p = ajustes.pesos;
  const n = ajustes.notificaciones ?? {};
  const ing = ajustes.ingresoNormal ?? {};

  return envolver(`
    <h2>Ajustes</h2>

    <h3>Ingreso mensual normal</h3>
    <p style="font-size:13px">Entra solo cada día 1 y se reparte ${p.ESENCIALES / 100}/${p.INVERSION / 100}/${p.RESERVA / 100}/${p.RECOMPENSAS / 100}. No hace falta teclearlo cada mes.</p>
    <div class="campo">
      <label for="ing-normal">Cuánto ingresas al mes, normalmente</label>
      <input id="ing-normal" type="text" inputmode="decimal" data-campo="ingresoNormal"
             value="${ing.montoCents ? formatear(ing.montoCents).replace(/^\D+/, '') : ''}"
             placeholder="1.500">
      <span class="ayuda">${ing.configurado ? 'Cambiarlo afecta a los meses siguientes; el mes en curso no se recalcula.' : 'Todavía sin configurar.'}</span>
    </div>
    <div class="botones" style="margin-top:0">
      <button class="btn principal" data-accion="guardar-ingreso-normal">Guardar ingreso normal</button>
    </div>

    <h3>Reparto actual</h3>
    <div class="lista">
      ${ORDEN.map(
        (b) => `<div class="fila"><span class="t">${esc(ETIQUETAS[b])}</span><span class="v">${p[b] / 100} %</span></div>`,
      ).join('')}
    </div>

    <h3>Destinos</h3>
    <p style="font-size:13px">Lo que aparece al elegir cada techo. Esenciales no lleva: usa categoría y nota libre.</p>
    ${ORDEN.filter((b) => destinosDe(ajustes, b).length > 0)
      .map(
        (b) => `<div class="lista" style="margin-bottom:8px">
          <div class="fila" style="background:var(--sup-2)"><span class="t" style="font-weight:600">${esc(ETIQUETAS[b])}</span>
            <span class="v"><button data-accion="añadir-destino" data-bucket="${b}" style="color:var(--acento);font-weight:600">+ añadir</button></span></div>
          ${destinosDe(ajustes, b)
            .map(
              (d) => `<div class="fila"><span class="t">${esc(d.nombre)}${d.pideTexto ? ' <small style="color:var(--tinta-3)">· pide texto</small>' : ''}</span>
                <span class="v"><button data-accion="renombrar-destino" data-bucket="${b}" data-destino="${esc(d.id)}" style="color:var(--acento)">editar</button></span></div>`,
            )
            .join('')}
        </div>`,
      )
      .join('')}

    <h3>Ingresos informales</h3>
    <div class="campo">
      <label for="umbral">A partir de cuánto te pregunto cómo repartirlo</label>
      <input id="umbral" type="text" inputmode="decimal" data-campo="umbralPregunta"
             value="${formatear(ajustes.umbralPregunta ?? 5000).replace(/^\D+/, '')}">
      <span class="ayuda">Por debajo va mitad Inversión, mitad Reserva, sin preguntar.</span>
    </div>
    <div class="botones" style="margin-top:0">
      <button class="btn" data-accion="guardar-umbral">Guardar umbral</button>
    </div>

    <h3>Avisos</h3>
    ${[
      ['sobrante', 'Lo que te sobra, al acabar el mes'],
      ['informe', 'Informe de cierre listo'],
      ['subfinanciamiento', 'Revisión de fondo del reparto'],
      ['proyeccion', 'Proyección de sobrepaso'],
      ['inactividad', 'Llevo días sin registrar'],
    ]
      .map(
        ([k, t]) => `<div class="interruptor">
          <span class="txt">${esc(t)}</span>
          <button class="palanca" data-accion="alternar-aviso" data-aviso="${k}"
                  aria-pressed="${Boolean(n[k])}" aria-label="${esc(t)}"></button>
        </div>`,
      )
      .join('')}

    <h3>Las 18 reglas</h3>
    <p style="font-size:12.5px">No se pueden desactivar. Si pudieras apagarlas, dejarían de servir justo el primer día difícil.</p>
    <div class="lista">
      ${REGLAS_NUCLEO.map(
        (r) => `<div class="fila"><span class="t">${esc(r.mensaje)}</span><span class="v">${esc(r.id)}</span>
          <span class="s">${esc(r.porque.slice(0, 90))}…</span></div>`,
      ).join('')}
    </div>

    <h3>Almacén</h3>
    <div class="lista">
      <div class="fila"><span class="t">Motor</span><span class="v">${esc(estadisticas.motor)}</span>
        <span class="s">${estadisticas.persistente ? 'los datos sobreviven al cierre' : 'solo en memoria de esta sesión'}</span></div>
      <div class="fila"><span class="t">Cifrado</span><span class="v">${boveda.cifra ? 'sí' : 'no'}</span>
        <span class="s">${boveda.cifra ? esc(boveda.modo) : 'los datos se guardan en claro en este dispositivo'}</span></div>
      <div class="fila"><span class="t">Movimientos</span><span class="v">${estadisticas.movimientos}</span></div>
      <div class="fila"><span class="t">Meses</span><span class="v">${estadisticas.periodos}</span></div>
    </div>

    <div class="botones">
      <button class="btn" data-accion="exportar">Exportar copia</button>
      <button class="btn" data-accion="cerrar-hoja">Cerrar</button>
      <button class="btn peligro" data-accion="borrar-todo">Borrar todo</button>
    </div>`);
}

export function hojaFondos({ fondos, entradasAhorro, entradasCartera }) {
  const lista = (entradas) =>
    entradas.length
      ? `<div class="lista">${entradas
          .map(
            (e) =>
              `<div class="fila"><span class="t">${esc(nombrePeriodo(e.periodId ?? '—'))}</span>
                <span class="v pos">+${formatear(e.delta)}</span>
                <span class="s">${esc(e.motivo ?? '')}</span></div>`,
          )
          .join('')}</div>`
      : '<p class="vacio">Todavía no hay aportes. El primero llega con el cierre del mes.</p>';

  return envolver(`
    <h2>Fondos</h2>
    <p>Estos dos saldos no se reinician nunca. Son lo que queda cuando el mes se cierra.</p>

    <h3>Fondo de Ahorro · ${formatear(fondos?.FONDO_AHORRO?.saldoCents ?? 0)}</h3>
    ${lista(entradasAhorro)}

    <h3>Cartera de Inversión · ${formatear(fondos?.CARTERA_INVERSION?.saldoCents ?? 0)}</h3>
    ${lista(entradasCartera)}

    <div class="botones"><button class="btn" data-accion="cerrar-hoja">Cerrar</button></div>`);
}


/**
 * Alta inicial (§14). Una sola pregunta, y a usar la app.
 * Sustituye al PIN y al anclaje mensual de saldo.
 */
export function hojaAlta({ moneda = 'R$' }) {
  return `<div class="velo" style="align-items:center"><div class="hoja" data-parar style="border-radius:18px;margin:0 14px;max-width:420px">
    <h2 style="margin-top:10px">¿Cuánto ingresas al mes?</h2>
    <p>Lo pregunto una vez. A partir de ahí entra solo cada día 1 y se reparte en tus cuatro techos. No tendrás que teclear el saldo nunca más.</p>
    <div class="campo">
      <label for="alta-ingreso">Tu ingreso mensual normal</label>
      <input id="alta-ingreso" type="text" inputmode="decimal" data-campo="altaIngreso"
             placeholder="1.500" autocomplete="off">
      <span class="ayuda">En ${esc(moneda)}. Podrás cambiarlo en Ajustes cuando quieras.</span>
    </div>
    <div class="botones">
      <button class="btn principal" data-accion="guardar-alta">Empezar</button>
      <button class="btn" data-accion="saltar-alta">Ahora no</button>
    </div>
    <p style="font-size:11.5px;color:var(--tinta-3);text-align:center;margin:14px 0 0">
      Si tu ingreso es irregular, sáltalo y registra cada cobro a mano.
    </p>
  </div></div>`;
}

/**
 * Destinos de un techo (§2, §3, §4).
 *
 * Reserva tiene uno solo y ni siquiera abre esta hoja: se registra directo.
 * «Otro» pide escribir; el resto se guarda de un toque.
 */
export function hojaDestinos({ bucket, ajustes, captura, importeTexto }) {
  const lista = destinosDe(ajustes, bucket);
  const elegido = lista.find((d) => d.id === captura?.destinoId);
  const pideTexto = Boolean(elegido?.pideTexto);

  return envolver(`
    <h2>${esc(ETIQUETAS[bucket])} · ${esc(importeTexto ?? '')}</h2>
    <p>¿A dónde va?</p>

    <div class="botones" style="margin-top:4px">
      ${lista
        .map(
          (d) => `<button class="btn ${captura?.destinoId === d.id ? 'principal' : ''}"
              data-accion="elegir-destino" data-bucket="${bucket}" data-destino="${esc(d.id)}">
              ${esc(d.nombre)}
            </button>`,
        )
        .join('')}
    </div>

    ${pideTexto
      ? `<div class="campo" style="margin-top:16px">
           <label for="especifica">${esc(elegido.etiquetaTexto ?? 'Especifica')}</label>
           <input id="especifica" type="text" data-campo="destinoTexto"
                  value="${esc(captura?.destinoTexto ?? '')}" placeholder="¿Dónde exactamente?" autocomplete="off">
         </div>
         <div class="botones" style="margin-top:0">
           <button class="btn principal" data-accion="confirmar-destino" data-bucket="${bucket}">Guardar</button>
         </div>`
      : ''}

    <div class="botones"><button class="btn" data-accion="cerrar-hoja">Cancelar</button></div>`);
}

/**
 * Como repartir un ingreso informal grande (§9).
 * Tres opciones, con las cifras ya calculadas: nadie elige a ciegas.
 */
export function hojaDistribucion({ importeCents, opciones }) {
  const resumen = (r) => {
    if (!r) return '';
    const partes = ORDEN.filter((b) => r.partes[b] > 0)
      .map((b) => `${formatear(r.partes[b])} · ${ETIQUETAS[b]}`)
      .join('  ·  ');
    // Sin color en linea: dentro del boton destacado hay fondo acento y un
    // estilo inline ganaria a la hoja de estilo, dejando azul sobre azul.
    const nota = r.ajuste === 'TAPA_DEFICIT' || r.ajuste === 'TAPA_Y_REPARTE'
      ? '<br><small class="nota-aviso">Va a tapar lo que ya te habías pasado.</small>'
      : !r.fragmentado
        ? '<br><small>Entero, sin partirlo en céntimos.</small>'
        : '';
    return `<small>${esc(partes)}</small>${nota}`;
  };

  return envolver(`
    <h2>Entraron ${formatear(importeCents)}</h2>
    <p>¿Cómo quieres repartirlo? No se queda suelto: va a algún techo.</p>

    <div class="botones">
      ${opciones
        .map(
          (o) => `<button class="btn ${o.id === MODO.MITADES ? 'principal' : ''}"
              data-accion="elegir-distribucion" data-modo="${o.id}"
              style="text-align:left;line-height:1.45">
              <b>${esc(o.titulo)}</b> · ${esc(o.detalle)}<br>${resumen(o.reparto)}
            </button>`,
        )
        .join('')}
    </div>

    <div class="botones"><button class="btn" data-accion="cerrar-hoja">Cancelar</button></div>`);
}

/** Elegir a mano un techo para el ingreso (opcion 3 de §9). */
export function hojaDistribucionManual({ importeCents, periodo }) {
  return envolver(`
    <h2>¿Dónde pongo ${formatear(importeCents)}?</h2>
    <div class="botones">
      ${ORDEN.map((b) => {
        const libre = margen(periodo, b);
        return `<button class="btn" data-accion="elegir-bucket-ingreso" data-bucket="${b}" style="text-align:left">
            <b>${esc(ETIQUETAS[b])}</b>
            <small style="color:var(--tinta-3)"> · ${libre < 0 ? `rebasado en ${formatear(-libre)}` : `${formatear(libre)} libres`}</small>
          </button>`;
      }).join('')}
    </div>
    <div class="botones"><button class="btn" data-accion="cerrar-hoja">Atrás</button></div>`);
}

/**
 * Sobrante del mes e historial (§11 a §13).
 *
 * La cifra del mes cerrado no cambia nunca. Elegir destino solo anota que se
 * hizo con ella.
 */
export function hojaSobrante({ pendiente, sobranteActual, historial, media, fondos }) {
  const filasHistorial = ordenarHistorial(historial ?? []);

  const bloquePendiente = pendiente
    ? `<div class="aviso verde" style="margin:0 0 16px">
         <strong>Te sobraron ${formatear(pendiente.sobranteCents)} en ${esc(nombrePeriodo(pendiente.periodId))}.</strong>
         Puedes invertirlos o mandarlos a tu reserva.
       </div>
       <div class="botones" style="margin-top:0">
         ${DESTINOS_SOBRANTE.map(
           (d) => `<button class="btn ${d.id === 'INVERSION' ? 'principal' : ''}"
               data-accion="resolver-sobrante" data-periodo="${esc(pendiente.periodId)}" data-destino="${d.id}">
               ${esc(d.nombre)}
             </button>`,
         ).join('')}
       </div>`
    : '';

  const bloqueActual = sobranteActual?.hay
    ? `<h3>Este mes, por ahora</h3>
       <div class="lista">
         <div class="fila"><span class="t">Libre ahora mismo</span><span class="v pos">${formatear(sobranteActual.sobranteCents)}</span>
           <span class="s">de Esenciales y Recompensas · aún puede bajar si gastas</span></div>
         ${Object.entries(sobranteActual.desglose ?? {})
           .map(([b, c]) => `<div class="fila"><span class="t">${esc(ETIQUETAS[b])}</span><span class="v">${formatear(c)}</span></div>`)
           .join('')}
       </div>`
    : '';

  // Los fondos viven aqui desde que se quito la tarjeta del panel: son dinero
  // acumulado, igual que el sobrante, y en el panel solo ocupaban sitio
  // enseñando dos ceros los primeros meses.
  const bloqueFondos = `
    <h3>Fondos</h3>
    <div class="lista">
      <div class="fila"><span class="t">Fondo de Ahorro</span>
        <span class="v pos">${formatear(fondos?.FONDO_AHORRO?.saldoCents ?? 0)}</span>
        <span class="s">lo que no gastaste de Reserva, mes a mes</span></div>
      <div class="fila"><span class="t">Cartera de Inversión</span>
        <span class="v pos">${formatear(fondos?.CARTERA_INVERSION?.saldoCents ?? 0)}</span>
        <span class="s">lo que no gastaste de Inversión</span></div>
    </div>
    <div class="botones" style="margin-top:8px">
      <button class="btn" data-accion="ver-fondos">Ver movimientos de los fondos</button>
    </div>`;

  return envolver(`
    <h2>Lo que te sobra</h2>
    ${bloquePendiente}
    ${bloqueActual}
    ${bloqueFondos}

    <h3>Historial</h3>
    ${filasHistorial.length
      ? `<div class="lista">${filasHistorial
          .map(
            (r) => `<div class="fila">
              <span class="t">${esc(nombrePeriodo(r.periodId))}</span>
              <span class="v ${r.sobranteCents > 0 ? 'pos' : ''}">${formatear(r.sobranteCents)}</span>
              <span class="s">${r.destino ? esc(etiquetaSobrante(r.destino)) : 'sin decidir'}</span>
            </div>`,
          )
          .join('')}</div>
         ${media > 0 ? `<p style="font-size:12.5px;margin-top:10px">De media te sobran ${formatear(media)} al mes.</p>` : ''}`
      : '<p class="vacio">Todavía no hay meses cerrados. El primer sobrante se calcula al acabar este mes.</p>'}

    <p style="font-size:11.5px;color:var(--tinta-3);margin-top:14px">
      El sobrante de un mes no cambia aunque después lo inviertas: es lo que pasó ese mes.
    </p>

    <div class="botones"><button class="btn" data-accion="cerrar-hoja">Cerrar</button></div>`);
}

function etiquetaSobrante(destino) {
  const d = DESTINOS_SOBRANTE.find((x) => x.id === destino);
  return d ? d.nombre : destino;
}

export { envolver };
