/**
 * Piezas reutilizables de la interfaz.
 *
 * Sin framework: cada funcion devuelve una cadena de HTML y los eventos se
 * resuelven por delegacion desde un unico oyente en la raiz. A esta escala es
 * mas rapido y mucho menos codigo que cualquier alternativa.
 */

import { formatear, porcentaje, MONEDA } from '../dominio/dinero.js';
import { ORDEN, ETIQUETAS } from '../dominio/buckets.js';
import { margen, ritmo, diasEnPeriodo, diaDeFecha, nombrePeriodo } from '../dominio/periodo.js';

/** Escapa texto que viene del usuario antes de inyectarlo en el HTML. */
export function esc(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Barra de un techo, con marca de ritmo y trama en el sobrepaso. */
export function barraTecho(periodo, bucket, fechaHoy) {
  const techo = periodo.techos[bucket] ?? 0;
  const gastado = periodo.totales[bucket] ?? 0;
  const disponible = margen(periodo, bucket);
  const rebasado = disponible < 0;
  const pct = techo > 0 ? Math.min(100, (gastado / techo) * 100) : 0;
  const ritmoPct = techo > 0 ? ritmo(periodo.id, fechaHoy) * 100 : 0;

  return `
    <button class="techo" data-accion="detalle-techo" data-bucket="${bucket}"
            aria-label="${ETIQUETAS[bucket]}: ${porcentaje(gastado, techo)} por ciento usado, ${
              techo > 0 && gastado / techo > ritmoPct / 100 ? 'por delante del' : 'por detrás del'
            } ritmo del mes">
      <span class="nombre">${ETIQUETAS[bucket]}</span>
      <span class="cifra ${rebasado ? 'rebasado' : ''}">
        <b>${formatear(Math.abs(disponible))}</b> ${rebasado ? 'de más' : 'libres'}
      </span>
      <span class="pista">
        <span class="canal">
          <span class="relleno ${rebasado ? 'rebasado' : ''}" style="width:${techo > 0 ? pct : 0}%"></span>
        </span>
        ${techo > 0 ? `<span class="marca-ritmo" style="left:${ritmoPct}%"
              title="Por aquí va el mes"></span>` : ''}
      </span>
    </button>`;
}

export function panelTechos(periodo, fechaHoy) {
  return `<div class="techos">${ORDEN.map((b) => barraTecho(periodo, b, fechaHoy)).join('')}</div>`;
}

/** Teclado numerico propio: aparece al instante y no ofrece caracteres invalidos. */
export function teclado() {
  const teclas = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '←'];
  return `<div class="teclado">${teclas
    .map((t) => {
      const accion = t === '←' ? 'borrar' : t === ',' ? 'coma' : 'digito';
      const esAccion = t === '←' || t === ',';
      return `<button class="tecla ${esAccion ? 'accion' : ''}" data-accion="${accion}" data-valor="${t}"
               aria-label="${t === '←' ? 'Borrar' : t === ',' ? 'Coma decimal' : t}">${t}</button>`;
    })
    .join('')}</div>`;
}

/** Cuatro fichas de techo con el margen restante debajo. */
export function fichasBucket(periodo, seleccionado) {
  return `<div class="fichas">${ORDEN.map((b) => {
    const restante = margen(periodo, b);
    return `
      <button class="ficha" data-accion="elegir-bucket" data-bucket="${b}"
              aria-pressed="${seleccionado === b}">
        ${ETIQUETAS[b]}
        <span class="restante">${restante < 0 ? '−' : ''}${formatear(Math.abs(restante))}</span>
      </button>`;
  }).join('')}</div>`;
}

/**
 * Fichas de ingreso: multiseleccion con el reparto en vivo.
 *
 * Misma fila que las fichas de gasto, pero aqui se pueden marcar varias y cada
 * una enseña cuanto le tocaria ahora mismo. Asi la subdivision se ve antes de
 * guardar, no despues.
 */
export function fichasIngreso(seleccionadas, reparto) {
  return `<div class="fichas">${ORDEN.map((b) => {
    const marcado = seleccionadas.includes(b);
    const toca = reparto?.[b] ?? 0;
    return `
      <button class="ficha" data-accion="alternar-ingreso" data-bucket="${b}"
              aria-pressed="${marcado}">
        ${ETIQUETAS[b]}
        <span class="restante">${marcado ? (toca > 0 ? formatear(toca) : '—') : '·'}</span>
      </button>`;
  }).join('')}</div>`;
}

/** Visor del importe, con el texto de ayuda contextual debajo. */
export function visor(digitos, pista, modo, moneda = MONEDA) {
  const texto = digitos === '' ? '0' : digitos;
  return `
    <div class="visor">
      <span class="importe ${digitos === '' ? 'vacio' : ''}">${modo === 'ingreso' ? '+' : ''}${esc(moneda)}${esc(texto)}</span>
      <span class="pista-txt">${esc(pista ?? '')}</span>
    </div>`;
}

export function filaMovimiento(mov, categorias) {
  const cat = categorias?.[mov.categoryId]?.nombre ?? (mov.tipo === 'ingreso' ? 'Ingreso' : 'Sin categoría');
  const signo = mov.tipo === 'ingreso' ? 'pos' : '';
  return `
    <div class="fila">
      <span class="t">${esc(cat)}</span>
      <span class="v ${signo}">${mov.tipo === 'ingreso' ? '+' : ''}${formatear(mov.importeCents)}</span>
      <span class="s">${esc(mov.localDate)} · ${esc(ETIQUETAS[mov.bucket] ?? (mov.tipo === 'ingreso' ? 'repartido' : '—'))}${
        mov.nota ? ` · ${esc(mov.nota.slice(0, 40))}` : ''
      }</span>
    </div>`;
}

export function cabecera(periodo, estado) {
  const dia = diaDeFecha(estado.fecha);
  const dias = diasEnPeriodo(periodo.id);
  const hayAlerta = Boolean(estado.diagnostico) || Boolean(estado.sobrantePendiente);

  return `
    <header class="cabecera">
      <span>
        <span class="periodo">${esc(nombrePeriodo(periodo.id))}</span>
        <span class="sub">día ${dia} de ${dias}</span>
      </span>
      <span class="iconos">
        <button class="icono" data-accion="ver-informe" aria-label="Informe de cierre">▤</button>
        <button class="icono ${hayAlerta ? 'alerta' : ''}" data-accion="ver-sobrante" aria-label="Lo que te sobra">◈</button>
        <button class="icono" data-accion="ver-ajustes" aria-label="Ajustes">⚙</button>
      </span>
    </header>`;
}

export function avisoDiagnostico(dx) {
  if (!dx?.alerta) return '';
  const a = dx.alerta;
  return `
    <div class="aviso rojo">
      <strong>${esc(a.titular)}</strong>
      ${esc(a.evidencia)}
      <div class="acciones">
        <button class="principal" data-accion="ver-diagnostico">Ver propuesta</button>
      </div>
    </div>`;
}

/**
 * Aviso del sobrante (§11). Dos momentos: la vispera del cierre, avisando de
 * lo que va a quedar libre, y despues del cierre, cuando ya hay una cifra
 * cerrada esperando destino.
 */
export function avisoSobrante(estado) {
  const pendiente = estado.sobrantePendiente;
  if (pendiente) {
    return `
      <div class="aviso verde">
        <strong>Te sobraron ${formatear(pendiente.sobranteCents)} en ${esc(nombrePeriodo(pendiente.periodId))}.</strong>
        Puedes invertirlos o destinarlos a tu reserva.
        <div class="acciones">
          <button class="principal" data-accion="ver-sobrante">Decidir</button>
        </div>
      </div>`;
  }

  const s = estado.sobrante;
  if (s?.vispera && s.hay) {
    return `
      <div class="aviso ambar">
        <strong>Se acaba el mes.</strong>
        Te han quedado ${formatear(s.sobranteCents)} libres. Puedes invertirlos o destinarlos a tu reserva.
        <div class="acciones">
          <button class="principal" data-accion="ver-sobrante">Ver</button>
        </div>
      </div>`;
  }
  return '';
}

export { formatear, ETIQUETAS, ORDEN };
