/**
 * Evaluador del AST de predicados de las reglas (§7.1).
 *
 * Las condiciones de las reglas son datos, no funciones. Eso permite
 * guardarlas en IndexedDB, versionarlas, evaluarlas en un worker y —lo que
 * de verdad importa— explicarle al usuario que condicion concreta se cumplio,
 * en su idioma, en vez de mostrarle el identificador de la regla.
 */

import { diaDeFecha } from './periodo.js';

/** Lee un campo del movimiento admitiendo rutas con punto. */
function campo(mov, ruta) {
  return ruta.split('.').reduce((o, k) => (o == null ? undefined : o[k]), mov);
}

function comoLista(valor) {
  if (valor == null) return [];
  return Array.isArray(valor) ? valor : [valor];
}

/**
 * Operadores disponibles. Cada uno recibe (args, mov, ctx) y devuelve booleano.
 * Añadir uno nuevo aqui lo hace utilizable por cualquier regla sin tocar nada mas.
 */
export const OPERADORES = {
  and: (args, mov, ctx) => args.every((a) => evaluar(a, mov, ctx)),
  or: (args, mov, ctx) => args.some((a) => evaluar(a, mov, ctx)),
  not: (args, mov, ctx) => !evaluar(args[0], mov, ctx),
  siempre: () => true,

  /** La categoria del movimiento esta en la lista. */
  categoriaEn: (args, mov) => args.includes(mov.categoryId),

  /** La categoria pertenece a alguno de los grupos indicados (catalogo). */
  grupoEn: (args, mov, ctx) => {
    const cat = ctx.categorias?.[mov.categoryId];
    return cat ? args.includes(cat.grupo) : false;
  },

  /** El movimiento lleva alguna de estas etiquetas. */
  tagEn: (args, mov) => comoLista(mov.tags).some((t) => args.includes(t)),

  /** El bucket propuesto es uno de estos. */
  bucketEs: (args, mov) => args.includes(mov.bucket),

  /** El tipo es 'gasto' o 'ingreso'. */
  tipoEs: (args, mov) => args.includes(mov.tipo),

  /** El tipo de comercio declarado esta en la lista. */
  comercioTipoEn: (args, mov) => args.includes(mov.comercioTipo),

  /** Un campo booleano del movimiento es verdadero. */
  campoVerdadero: (args, mov) => campo(mov, args[0]) === true,

  /** Un campo es exactamente igual a un valor. */
  campoEs: (args, mov) => campo(mov, args[0]) === args[1],

  /** Un campo tiene valor (no vacio). */
  campoPresente: (args, mov) => {
    const v = campo(mov, args[0]);
    return v !== undefined && v !== null && v !== '';
  },

  /** La nota tiene al menos N caracteres utiles. */
  notaMinima: (args, mov) => (mov.nota ?? '').trim().length >= args[0],

  /** El importe supera una fraccion del techo de su bucket. */
  fraccionDelTechoMayorQue: (args, mov, ctx) => {
    const techo = ctx.periodo?.techos?.[mov.bucket] ?? 0;
    if (techo <= 0) return false;
    return mov.importeCents / techo > args[0];
  },

  /** El importe supera una fraccion del techo de otro bucket concreto. */
  fraccionDelTechoDeMayorQue: (args, mov, ctx) => {
    const techo = ctx.periodo?.techos?.[args[0]] ?? 0;
    if (techo <= 0) return false;
    return mov.importeCents / techo > args[1];
  },

  /** La fecha local del movimiento es posterior a hoy. */
  fechaFutura: (_args, mov, ctx) => Boolean(ctx.fechaHoy) && mov.localDate > ctx.fechaHoy,

  /** Importe no positivo. */
  importeNoPositivo: (_args, mov) => !(mov.importeCents > 0),

  /** Importe absurdo: mas de N veces la mediana reciente. */
  importeAtipico: (args, mov, ctx) => {
    const mediana = ctx.medianaImporte ?? 0;
    if (mediana <= 0) return false;
    return mov.importeCents > mediana * args[0];
  },

  /** El movimiento apunta a un periodo ya cerrado. */
  periodoCerrado: (_args, mov, ctx) => Boolean(ctx.periodosCerrados?.includes(mov.periodId)),

  /** Modifica o corrige un movimiento existente. */
  esCorreccion: (_args, mov) => Boolean(mov.corrigeA),

  /**
   * Hay al menos N movimientos previos a este bucket en las ultimas H horas.
   * Cuenta el actual, de ahi el >= en vez de >.
   */
  conteoRecienteAlMenos: (args, mov, ctx) => {
    const [bucket, horas, minimo] = args;
    const recientes = ctx.movimientosRecientes ?? [];
    const desde = (mov.ts ?? 0) - horas * 3_600_000;
    const n = recientes.filter(
      (m) => m.bucket === bucket && m.tipo === 'gasto' && m.ts >= desde && m.ts <= (mov.ts ?? 0),
    ).length;
    return n + 1 >= minimo;
  },

  /** Dia del mes del movimiento dentro de un rango. */
  diaEntre: (args, mov) => {
    const d = diaDeFecha(mov.localDate ?? '0000-00-00');
    return d >= args[0] && d <= args[1];
  },
};

/**
 * Evalua un nodo del AST.
 * Un operador desconocido devuelve false en vez de lanzar: una regla rota no
 * puede impedir que el usuario registre un gasto.
 */
export function evaluar(nodo, mov, ctx = {}) {
  if (nodo == null) return false;
  if (typeof nodo === 'boolean') return nodo;
  const fn = OPERADORES[nodo.op];
  if (!fn) {
    if (ctx.onOperadorDesconocido) ctx.onOperadorDesconocido(nodo.op);
    return false;
  }
  return Boolean(fn(nodo.args ?? [], mov, ctx));
}

/**
 * Describe en lenguaje natural que parte del predicado se cumplio.
 * Es lo que convierte un rechazo en una explicacion (§7.3).
 */
export function explicar(nodo, mov, ctx = {}) {
  if (nodo == null) return [];
  if (nodo.op === 'and' || nodo.op === 'or') {
    return (nodo.args ?? []).flatMap((a) => explicar(a, mov, ctx));
  }
  if (nodo.op === 'not') return [];
  if (!evaluar(nodo, mov, ctx)) return [];

  const a = nodo.args ?? [];
  switch (nodo.op) {
    case 'categoriaEn':
      return [`la categoría es «${ctx.categorias?.[mov.categoryId]?.nombre ?? mov.categoryId}»`];
    case 'grupoEn':
      return [`pertenece al grupo «${a.join(' o ')}»`];
    case 'tagEn':
      return [`lleva la etiqueta «${a.join(' o ')}»`];
    case 'bucketEs':
      return [`lo estás guardando en ${a.join(' o ')}`];
    case 'comercioTipoEn':
      return [`el comercio es de tipo «${a.join(' o ')}»`];
    case 'fraccionDelTechoMayorQue':
      return [`supera el ${Math.round(a[0] * 100)} % del techo`];
    case 'fechaFutura':
      return ['la fecha es posterior a hoy'];
    case 'importeAtipico':
      return [`el importe es ${a[0]}× mayor de lo habitual`];
    case 'periodoCerrado':
      return ['el mes ya está cerrado'];
    case 'conteoRecienteAlMenos':
      return [`es el ${a[2]}.º movimiento a ${a[0]} en ${a[1]} h`];
    default:
      return [];
  }
}
