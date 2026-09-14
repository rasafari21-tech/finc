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
import { REGLAS_NUCLEO } from '../dominio/reglas.js';
import { etiquetaDestino } from '../dominio/carry.js';
import { porcentaje } from '../dominio/dinero.js';

/**
 * Envoltorio comun de todas las hojas.
 *
 * Aqui vive la semantica de dialogo, y por eso esta en un solo sitio: las diez
 * hojas la heredan y cualquiera nueva tambien. Sin esto, abrir una hoja no
 * anunciaba nada a un lector de pantalla y el foco se quedaba detras.
 *
 * El id del titulo se genera al vuelo y se engancha al primer <h2>, que todas
 * tienen, para que aria-labelledby apunte a algo real.
 */
let contadorHojas = 0;

const envolver = (contenido) => {
  const idTitulo = `hoja-tit-${++contadorHojas}`;
  const conId = contenido.replace('<h2', `<h2 id="${idTitulo}"`);
  return `<div class="velo" data-accion="cerrar-hoja">
    <div class="hoja" data-parar role="dialog" aria-modal="true" aria-labelledby="${idTitulo}" tabindex="-1">
      <div class="asa" aria-hidden="true"></div>${conId}
    </div></div>`;
};

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
      ? `<h3>Últimos movimientos</h3>
         <p style="font-size:12.5px;margin:-4px 0 8px">Toca cualquiera para corregirlo o anularlo.</p>
         <div class="lista">${delBucket.map((m) => filaMovimiento(m, CATEGORIAS, true)).join('')}</div>`
      : '<p class="vacio">Todavía no hay movimientos en este techo.<br>Aparecerán aquí en cuanto registres el primero.</p>'}

    <div class="botones"><button class="btn" data-accion="cerrar-hoja">Cerrar</button></div>`);
}

/** Informe de cierre archivado. */
export function hojaInforme({ informe, periodId, disponibles = [] }) {
  if (!informe) {
    return envolver(`
      <h2>Aún no hay informes</h2>
      <p>El primero se genera solo cuando termine el mes en curso: archiva lo gastado en cada
      techo, manda a tu Fondo lo que no usaste de Reserva y calcula lo que te sobró.</p>
      <p>No tienes que hacer nada. Basta con abrir la app algún día después del 1.</p>
      <div class="botones"><button class="btn" data-accion="cerrar-hoja">Entendido</button></div>`);
  }

  // Selector de mes: los informes estan todos guardados en archives, solo que
  // hasta ahora no habia forma de llegar a ninguno salvo al ultimo.
  const selector = disponibles.length > 1
    ? `<div class="filtros" style="margin-bottom:16px">
         <select data-campo="mesInforme" aria-label="Mes del informe">
           ${disponibles.map((m) => `<option value="${m}" ${m === informe.periodId ? 'selected' : ''}>${esc(nombrePeriodo(m))}</option>`).join('')}
         </select>
       </div>`
    : '';

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
    ${selector}
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

    <div class="aviso" style="margin:20px 0 0">
      <strong>Buen momento para una copia.</strong>
      El mes está cerrado y no hay sincronización: este teléfono es el único sitio
      donde viven tus datos.
      <div class="acciones">
        <button class="principal" data-accion="exportar">Exportar copia</button>
      </div>
    </div>

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

    <h3>Cómo funciona</h3>
    <div class="botones" style="margin-top:0">
      <button class="btn" data-accion="ver-intro">Volver a ver la explicación</button>
    </div>

    <h3>Copias de seguridad</h3>
    <p style="font-size:13px">No hay sincronización: este teléfono es el único sitio donde viven tus
    datos. Exporta de vez en cuando; el archivo se puede volver a cargar aquí mismo.</p>
    <div class="botones" style="margin-top:0">
      <button class="btn" data-accion="exportar">Exportar una copia</button>
      <button class="btn" data-accion="ver-importar">Restaurar una copia…</button>
    </div>

    <div class="botones">
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
  return `<div class="velo" style="align-items:center">
    <div class="hoja" data-parar role="dialog" aria-modal="true" aria-labelledby="alta-tit"
         tabindex="-1" style="border-radius:18px;margin:0 14px;max-width:420px">
    <h2 id="alta-tit" style="margin-top:10px">¿Cuánto ingresas al mes?</h2>
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
      : `<p class="vacio">Todavía no hay meses cerrados.<br>
           El primer sobrante se calcula solo al acabar este mes: será lo que no gastes
           de Esenciales y Recompensas.</p>`}

    <p style="font-size:11.5px;color:var(--tinta-3);margin-top:14px">
      El sobrante de un mes no cambia aunque después lo inviertas: es lo que pasó ese mes.
    </p>

    <div class="botones"><button class="btn" data-accion="cerrar-hoja">Cerrar</button></div>`);
}

function etiquetaSobrante(destino) {
  const d = DESTINOS_SOBRANTE.find((x) => x.id === destino);
  return d ? d.nombre : destino;
}


/**
 * Un movimiento, con las salidas para corregirlo (UX-01).
 *
 * En el mes abierto se puede cambiar el importe o anularlo. En un mes cerrado
 * no: el archivo es inmutable, asi que lo unico que se ofrece es anotar la
 * correccion en el mes en curso, que es lo que pide R-18.
 */
export function hojaMovimiento({ movimiento, editable, ajustes, borrador }) {
  const m = movimiento;
  const cat = CATEGORIAS[m.categoryId]?.nombre;
  const destino = etiquetaDeDestino(m, ajustes);
  const esIngreso = m.tipo === 'ingreso';

  return envolver(`
    <h2>${esIngreso ? 'Ingreso' : 'Gasto'} de ${formatear(m.importeCents)}</h2>

    <div class="lista">
      <div class="fila"><span class="t">Fecha</span><span class="v">${esc(m.localDate)}</span></div>
      ${m.bucket ? `<div class="fila"><span class="t">Techo</span><span class="v">${esc(ETIQUETAS[m.bucket] ?? m.bucket)}</span></div>` : ''}
      ${destino ? `<div class="fila"><span class="t">Destino</span><span class="v">${esc(destino)}</span></div>` : ''}
      ${cat ? `<div class="fila"><span class="t">Categoría</span><span class="v">${esc(cat)}</span></div>` : ''}
      ${m.nota ? `<div class="fila"><span class="t">Nota</span><span class="v" style="font-weight:400;text-align:left">${esc(m.nota)}</span></div>` : ''}
      ${m.bucketOriginal ? `<div class="fila"><span class="t">Lo intentaste en</span><span class="v">${esc(ETIQUETAS[m.bucketOriginal])}</span>
        <span class="s">una regla lo movió</span></div>` : ''}
    </div>

    ${editable
      ? `<h3>Corregir el importe</h3>
         <div class="campo">
           <label for="nuevo-importe">Cuánto era en realidad</label>
           <input id="nuevo-importe" type="text" inputmode="decimal" data-campo="nuevoImporte"
                  value="${esc(borrador ?? formatear(m.importeCents).replace(/^\D+/, ''))}" autocomplete="off">
         </div>
         <div class="botones" style="margin-top:0">
           <button class="btn principal" data-accion="guardar-correccion" data-id="${esc(m.id)}">Guardar el nuevo importe</button>
           <button class="btn peligro" data-accion="anular-movimiento" data-id="${esc(m.id)}">Anular este movimiento</button>
           <button class="btn" data-accion="cerrar-hoja">Dejarlo como está</button>
         </div>`
      : `<div class="aviso" style="margin:16px 0 0">
           <strong>Ese mes ya está cerrado.</strong>
           El archivo no se toca: es lo que hace que el histórico cuadre. Puedes anotar la
           corrección en el mes en curso.
         </div>
         <div class="botones">
           <button class="btn principal" data-accion="corregir-en-abierto" data-id="${esc(m.id)}">Anotar corrección en el mes abierto</button>
           <button class="btn" data-accion="cerrar-hoja">Cerrar</button>
         </div>`}`);
}

function etiquetaDeDestino(m, ajustes) {
  if (!m?.destinoId) return null;
  if (m.destinoTexto) return m.destinoTexto;
  return destinosDe(ajustes, m.bucket).find((d) => d.id === m.destinoId)?.nombre ?? m.destinoId;
}

/**
 * Restaurar una copia (UX-03).
 *
 * Sustituye todo lo que hay, asi que primero se enseña que trae el archivo y
 * que se va a perder. Nadie deberia pulsar esto sin ver las dos columnas.
 */
export function hojaImportar({ analisis, error }) {
  if (!analisis) {
    return envolver(`
      <h2>Restaurar una copia</h2>
      <p>Sustituye <strong>todo</strong> lo que hay en este teléfono por lo que traiga el archivo.
      Antes de nada te enseño qué contiene y qué se pierde.</p>
      ${error ? `<div class="aviso rojo" style="margin:0 0 14px"><strong>No pude leer ese archivo.</strong> ${esc(error)}</div>` : ''}
      <div class="botones">
        <button class="btn principal" data-accion="elegir-copia">Elegir archivo…</button>
        <button class="btn" data-accion="cerrar-hoja">Cancelar</button>
      </div>`);
  }

  const e = analisis.entrante;
  const a = analisis.actual;
  return envolver(`
    <h2>¿Restauro esta copia?</h2>
    <p>Lo de la izquierda desaparece. Lo de la derecha ocupa su lugar.</p>

    <div class="lista">
      <div class="fila"><span class="t">Meses</span>
        <span class="v"><span class="neg">${a.periodos}</span> → <span class="pos">${e.periodos}</span></span></div>
      <div class="fila"><span class="t">Movimientos</span>
        <span class="v"><span class="neg">${a.movimientos}</span> → <span class="pos">${e.movimientos}</span></span></div>
      ${e.primerMes ? `<div class="fila"><span class="t">Periodo de la copia</span>
        <span class="v">${esc(nombrePeriodo(e.primerMes))} – ${esc(nombrePeriodo(e.ultimoMes))}</span></div>` : ''}
      ${e.informes ? `<div class="fila"><span class="t">Informes archivados</span><span class="v">${e.informes}</span></div>` : ''}
      ${e.sobrantes ? `<div class="fila"><span class="t">Sobrantes</span><span class="v">${e.sobrantes}</span></div>` : ''}
    </div>

    <div class="aviso rojo" style="margin:16px 0 0">
      <strong>No hay vuelta atrás.</strong>
      Si lo de este teléfono te importa, expórtalo antes de restaurar.
    </div>

    <div class="botones">
      <button class="btn peligro" data-accion="confirmar-restauracion">Sí, restaurar y perder lo actual</button>
      <button class="btn" data-accion="exportar">Exportar lo de ahora primero</button>
      <button class="btn" data-accion="cerrar-hoja">Cancelar</button>
    </div>`);
}

/**
 * Detalles opcionales del registro: nota libre y fecha (UX-04, UX-05).
 *
 * Fuera del camino rapido a proposito. Quien registre y siga no la ve nunca;
 * quien quiera explicar algo o anotar lo del domingo, la abre.
 */
export function hojaDetalles({ captura, periodo, fechaHoy }) {
  const primerDia = `${periodo.id}-01`;
  const ultimoDia = `${periodo.id}-${String(diasEnPeriodo(periodo.id)).padStart(2, '0')}`;
  const tope = fechaHoy < ultimoDia ? fechaHoy : ultimoDia;

  return envolver(`
    <h2>Detalles</h2>
    <p>Los dos son opcionales. Sin tocarlos, el gasto se anota hoy y sin nota.</p>

    <div class="campo">
      <label for="det-nota">Nota</label>
      <textarea id="det-nota" data-campo="nota"
                placeholder="Para acordarte dentro de tres meses">${esc(captura?.nota ?? '')}</textarea>
      <span class="ayuda">Libre. Aparece en el historial y al abrir el movimiento.</span>
    </div>

    <div class="campo">
      <label for="det-fecha">Fecha</label>
      <input id="det-fecha" type="date" data-campo="fecha"
             value="${esc(captura?.localDate ?? fechaHoy)}"
             min="${esc(primerDia)}" max="${esc(tope)}">
      <span class="ayuda">Solo dentro del mes abierto: los meses cerrados no se tocan.</span>
    </div>

    <div class="botones">
      <button class="btn principal" data-accion="guardar-detalles">Aplicar</button>
      <button class="btn" data-accion="limpiar-detalles">Quitar nota y volver a hoy</button>
    </div>`);
}


/**
 * Historial de movimientos (UX-02).
 *
 * Agrupado por dia porque asi se recuerda el gasto: «el martes» antes que «el
 * 11 de septiembre». Cada fila abre el movimiento, que es desde donde se
 * corrige.
 */
export function hojaHistorial({ datos, meses, ajustes }) {
  const nombreDia = (fecha) => {
    const [a, m, d] = fecha.split('-').map(Number);
    const semana = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    return `${semana[new Date(Date.UTC(a, m - 1, d)).getUTCDay()]} ${d}`;
  };

  const filtros = `
    <div class="filtros">
      <select data-campo="mesHistorial" aria-label="Mes">
        ${meses.map((m) => `<option value="${m}" ${m === datos.periodId ? 'selected' : ''}>${esc(nombrePeriodo(m))}</option>`).join('')}
      </select>
      <input type="search" data-campo="buscaHistorial" placeholder="Buscar nota o destino…"
             value="${esc(datos.filtro.texto)}" aria-label="Buscar">
    </div>
    <div class="etiquetas" style="margin-bottom:16px">
      <button data-accion="filtrar-techo" data-bucket="" aria-pressed="${!datos.filtro.bucket}">Todos</button>
      ${ORDEN.map((b) => `<button data-accion="filtrar-techo" data-bucket="${b}"
            aria-pressed="${datos.filtro.bucket === b}">${esc(ETIQUETAS[b])}</button>`).join('')}
    </div>`;

  const cuerpo = datos.dias.length
    ? datos.dias.map((d) => `
        <div class="dia">
          <div class="dia-cab">
            <span class="dia-nom">${esc(nombreDia(d.fecha))}</span>
            <span class="dia-tot">
              ${d.gastado ? `−${formatear(d.gastado)}` : ''}
              ${d.ingresado ? `<span class="pos">+${formatear(d.ingresado)}</span>` : ''}
            </span>
          </div>
          <div class="lista">${d.movimientos.map((m) => filaMovimiento(m, CATEGORIAS, true)).join('')}</div>
        </div>`).join('')
    : `<p class="vacio">${datos.filtro.texto || datos.filtro.bucket
        ? 'Nada coincide con ese filtro.'
        : 'Este mes todavía no tiene movimientos.<br>Aparecerán aquí en cuanto registres el primero.'}</p>`;

  return envolver(`
    <h2>Movimientos</h2>
    ${filtros}
    ${cuerpo}
    ${datos.hayMas ? '<p style="font-size:12.5px;text-align:center">Se muestran los 120 más recientes.</p>' : ''}
    <div class="botones"><button class="btn" data-accion="cerrar-hoja">Cerrar</button></div>`);
}


/**
 * Introduccion en tres tarjetas (UX-10).
 *
 * Sin esto, la primera vez que una regla rechaza algo la reaccion razonable es
 * pensar que la app esta rota: nadie ha explicado nunca que hay un motor de
 * reglas, ni que el dia 1 va a pasar algo solo. Se enseña una vez, es
 * saltable, y queda accesible desde Ajustes.
 *
 * Usa las cifras de quien la lee, no ejemplos inventados.
 */
export function hojaIntro({ paso = 0, ingresoNormal = 0, pesos }) {
  const p = pesos ?? { ESENCIALES: 5000, INVERSION: 2500, RESERVA: 1500, RECOMPENSAS: 1000 };
  const parte = (b) => formatear(Math.round((ingresoNormal * p[b]) / 10_000));

  const pasos = [
    {
      titulo: 'Tu mes se parte en cuatro',
      cuerpo: ingresoNormal > 0
        ? `<p>Cada día 1 entran tus ${formatear(ingresoNormal)} y se reparten solos:</p>
           <div class="lista">
             ${ORDEN.map((b) => `<div class="fila"><span class="t">${esc(ETIQUETAS[b])}</span>
                <span class="v">${parte(b)}</span><span class="s">${p[b] / 100} %</span></div>`).join('')}
           </div>
           <p>Eso son tus <strong>techos</strong>. Cada gasto consume el suyo, y la barra te dice
           cuánto queda sin tener que sumar nada.</p>`
        : `<p>El dinero del mes se reparte en cuatro techos: Esenciales, Inversión, Reserva y
           Recompensas. Cada gasto consume el suyo, y la barra te dice cuánto queda.</p>`,
    },
    {
      titulo: 'A veces te va a decir que no',
      cuerpo: `<p>Hay dieciocho reglas que impiden colar un gasto donde no toca. Un regalo no
        entra en Esenciales por mucho que lo intentes: va a Recompensas, aunque sea para otra
        persona.</p>
        <p>No es para fastidiar. Un presupuesto no se rompe por el importe, se rompe por la
        etiqueta: basta llamar «esencial» a lo que no lo es para que las cuentas cuadren en el
        papel y no en el banco.</p>
        <p><strong>Nunca bloquea un gasto que ya ocurrió</strong>, solo la etiqueta que le pones.
        Si te pasas del techo, lo registra igual y lo pinta en rojo.</p>`,
    },
    {
      titulo: 'El día 1 pasa solo',
      cuerpo: `<p>Al abrir la app el día 1 —o el 7, da igual— se cierra el mes anterior sin que
        hagas nada: archiva el informe, manda a tu Fondo de Ahorro lo que no gastaste de Reserva
        y pone los cuatro techos a cero.</p>
        <p>También calcula <strong>lo que te sobró</strong> de Esenciales y Recompensas, y te
        pregunta qué hacer con ello. Esa cifra queda en el historial y ya no cambia, hagas lo
        que hagas después con el dinero.</p>`,
    },
  ];

  const actual = pasos[Math.min(paso, pasos.length - 1)];
  const ultimo = paso >= pasos.length - 1;

  return envolver(`
    <h2>${esc(actual.titulo)}</h2>
    ${actual.cuerpo}
    <div class="puntos-intro" aria-hidden="true">
      ${pasos.map((_, i) => `<span class="${i === paso ? 'activo' : ''}"></span>`).join('')}
    </div>
    <div class="botones">
      <button class="btn principal" data-accion="intro-siguiente" data-paso="${paso + 1}">
        ${ultimo ? 'Empezar' : 'Siguiente'}
      </button>
      ${ultimo ? '' : '<button class="btn" data-accion="intro-saltar">Saltar</button>'}
    </div>
    <p style="font-size:11.5px;color:var(--tinta-3);text-align:center;margin:14px 0 0">
      ${paso + 1} de ${pasos.length} · lo tienes otra vez en Ajustes
    </p>`);
}

export { envolver };
