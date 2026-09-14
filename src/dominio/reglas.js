/**
 * Las 18 reglas nucleo del motor de clasificacion (§7.2).
 *
 * Se evaluan por prioridad ascendente y la primera coincidencia decide.
 * Las marcadas `nucleo: true` no se pueden editar ni desactivar desde Ajustes:
 * si el usuario pudiera apagarlas, el motor dejaria de cumplir su funcion
 * exactamente el primer dia dificil, que es cuando hace falta.
 *
 * `cuando`     dispara la regla
 * `satisfecho` solo en REQUIRE_EVIDENCE: si se cumple, la regla deja pasar
 * `mensaje`    titulo que ve el usuario
 * `porque`     razonamiento, no el identificador de la regla
 */

import { ESENCIALES, INVERSION, RESERVA, RECOMPENSAS } from './buckets.js';

const op = (o, ...args) => ({ op: o, args });
const y = (...args) => ({ op: 'and', args });
const no = (a) => ({ op: 'not', args: [a] });

export const REGLAS_NUCLEO = [
  {
    id: 'R-18',
    prioridad: 1,
    nucleo: true,
    anulable: false,
    accion: 'DENY',
    cuando: y(op('periodoCerrado'), op('tipoEs', 'gasto', 'ingreso')),
    mensaje: 'Ese mes ya está cerrado.',
    porque:
      'El archivo es inmutable. Registra la corrección en el mes abierto: quedará enlazada al original y el histórico seguirá cuadrando.',
  },
  {
    id: 'R-16',
    prioridad: 5,
    nucleo: true,
    anulable: false,
    accion: 'DENY',
    cuando: op('fechaFutura'),
    mensaje: 'No se registran gastos futuros.',
    porque:
      'Un gasto que todavía no ha ocurrido no consume techo. Si quieres reservarlo, anótalo como compromiso programado.',
  },
  {
    id: 'R-17',
    prioridad: 6,
    nucleo: true,
    anulable: true,
    // CONFIRMAR, no DENY: basta un toque. Aqui no se escribe nada, solo se
    // dice si el numero es el que querias. Es una red contra el dedo gordo,
    // no una justificacion.
    accion: 'CONFIRMAR',
    cuando: { op: 'or', args: [op('importeNoPositivo'), op('importeAtipico', 100)] },
    mensaje: '¿Ese importe es correcto?',
    porque:
      'Es cien veces mayor que tu gasto habitual. Casi siempre es un cero de más al teclear; si de verdad era eso, sigue adelante.',
  },
  {
    id: 'R-01',
    prioridad: 10,
    nucleo: true,
    anulable: false,
    accion: 'FORCE',
    bucketDestino: RECOMPENSAS,
    cuando: y(op('grupoEn', 'regalo'), op('bucketEs', ESENCIALES, INVERSION)),
    mensaje: 'Un regalo no puede ir a Esenciales ni a Inversión.',
    porque:
      'Un regalo es una decisión afectiva, no una necesidad ni un activo. Va a Recompensas aunque sea para otra persona.',
  },
  {
    id: 'R-02',
    prioridad: 15,
    nucleo: true,
    anulable: false,
    accion: 'FORCE',
    bucketDestino: RECOMPENSAS,
    cuando: y(op('grupoEn', 'apuesta', 'cripto-especulativo'), op('bucketEs', INVERSION, ESENCIALES)),
    mensaje: 'Eso no es Inversión.',
    porque:
      'Invertir exige expectativa de rendimiento con riesgo acotado. Esto es consumo de entretenimiento con resultado aleatorio.',
  },
  {
    id: 'R-03',
    prioridad: 20,
    nucleo: true,
    anulable: false,
    accion: 'FORCE',
    bucketDestino: RECOMPENSAS,
    cuando: y(
      op('grupoEn', 'restaurante'),
      op('bucketEs', ESENCIALES, INVERSION),
      no(op('tagEn', 'viaje-laboral')),
    ),
    mensaje: 'El restaurante va a Recompensas.',
    porque: 'Comer es esencial; que lo cocine otro, no. La excepción es el desplazamiento laboral.',
  },
  {
    id: 'R-04',
    prioridad: 21,
    nucleo: true,
    anulable: false,
    accion: 'REQUIRE_EVIDENCE',
    bucketDestino: RECOMPENSAS,
    // Solo interroga cuando el tipo de comercio esta declarado y no es de
    // alimentacion. Sin esta guarda, el registro rapido —que no pide tipo de
    // comercio— pediria justificacion en cada compra de supermercado, y la
    // regla acabaria desactivada de facto por agotamiento del usuario.
    cuando: y(
      op('grupoEn', 'restaurante', 'mercado'),
      op('bucketEs', ESENCIALES),
      op('campoPresente', 'comercioTipo'),
      no(op('comercioTipoEn', 'supermercado', 'mercado')),
    ),
    satisfecho: y(op('tagEn', 'viaje-laboral'), op('notaMinima', 10)),
    mensaje: 'Necesito saber por qué esto es esencial.',
    porque:
      'Se admite si fue un desplazamiento laboral. Marca la etiqueta «viaje laboral» y escribe una nota de al menos 10 caracteres.',
    requisitos: ['Etiqueta «viaje laboral»', 'Nota de 10 caracteres o más'],
  },
  {
    id: 'R-05',
    prioridad: 25,
    nucleo: true,
    anulable: false,
    accion: 'FORCE',
    bucketDestino: RECOMPENSAS,
    cuando: y(op('grupoEn', 'suscripcion'), op('bucketEs', ESENCIALES, INVERSION, RESERVA)),
    mensaje: 'Las suscripciones de entretenimiento van a Recompensas.',
    porque: 'Una suscripción no se vuelve esencial por ser recurrente. Solo cambia de ser un gasto a ser un goteo.',
  },
  {
    id: 'R-06',
    prioridad: 30,
    nucleo: true,
    anulable: false,
    accion: 'REQUIRE_EVIDENCE',
    bucketDestino: RECOMPENSAS,
    cuando: y(op('grupoEn', 'gadget'), op('bucketEs', INVERSION)),
    satisfecho: y(
      op('campoVerdadero', 'usoProfesional'),
      no(op('fraccionDelTechoDeMayorQue', INVERSION, 0.15)),
      op('notaMinima', 15),
    ),
    mensaje: 'Justifica este aparato como herramienta.',
    porque:
      'Entra en Inversión si es de uso profesional, cuesta menos del 15 % de tu techo de Inversión y explicas para qué. Si no, es Recompensas.',
    requisitos: ['Marcar «uso profesional»', 'Importe ≤ 15 % del techo de Inversión', 'Nota de 15 caracteres o más'],
  },
  {
    id: 'R-08',
    prioridad: 35,
    nucleo: true,
    anulable: false,
    accion: 'DENY',
    // Un destino declarado vale como motivo: «Cachinha de Nubank» dice a donde
    // fue el dinero con mas precision que cualquier codigo. La regla sigue
    // impidiendo lo que importa, que es mover Reserva sin dejar rastro.
    cuando: y(
      op('bucketEs', RESERVA),
      op('tipoEs', 'gasto'),
      no(op('campoPresente', 'razonReserva')),
      no(op('campoPresente', 'destinoId')),
    ),
    mensaje: 'La Reserva no se mueve sin decir a dónde.',
    porque:
      'Elige el destino, o declara el motivo si es una retirada: salud, reparación, desempleo, legal o justificado. Es lo que impide que la Reserva se convierta en una cuenta corriente.',
  },
  {
    id: 'R-09',
    prioridad: 40,
    nucleo: true,
    anulable: false,
    accion: 'FORCE',
    bucketDestino: RECOMPENSAS,
    cuando: y(op('grupoEn', 'belleza'), op('bucketEs', ESENCIALES, INVERSION), no(op('tagEn', 'prescripcion-medica'))),
    mensaje: 'La estética va a Recompensas.',
    porque:
      'La higiene básica es Esencial; el tratamiento estético es Recompensa. Lo que separa ambos es la prescripción médica.',
  },
  {
    id: 'R-10',
    prioridad: 45,
    nucleo: true,
    anulable: false,
    accion: 'FORCE',
    bucketDestino: RECOMPENSAS,
    cuando: y(
      op('grupoEn', 'formacion'),
      op('bucketEs', INVERSION),
      no(y(op('campoVerdadero', 'certificable'), op('campoVerdadero', 'relacionadaConIngreso'))),
    ),
    mensaje: 'Esa formación todavía no es Inversión.',
    porque:
      'Formarse es Inversión cuando aumenta de forma verificable tu capacidad de generar ingreso. Si no, es un interés personal legítimo, pero es Recompensa.',
  },
  {
    id: 'R-11',
    prioridad: 50,
    nucleo: true,
    anulable: false,
    accion: 'FORCE',
    bucketDestino: ESENCIALES,
    cuando: y(op('categoriaEn', 'deuda-minimo'), op('bucketEs', INVERSION, RESERVA, RECOMPENSAS)),
    mensaje: 'El pago mínimo de deuda es Esencial.',
    porque:
      'El mínimo es obligación contractual, no elección. Lo que pagues por encima del mínimo sí es Inversión: amortizar es rendimiento garantizado.',
  },
  {
    id: 'R-12',
    prioridad: 55,
    nucleo: true,
    anulable: false,
    accion: 'FORCE',
    bucketDestino: RECOMPENSAS,
    cuando: y(op('grupoEn', 'mascota-accesorio'), op('bucketEs', ESENCIALES, INVERSION)),
    mensaje: 'Los accesorios de mascota van a Recompensas.',
    porque:
      'El alimento y el veterinario sí son Esenciales; el juguete, la ropita y el collar nuevo son un gusto, y está bien que lo sean.',
  },
  {
    id: 'R-13',
    prioridad: 60,
    nucleo: true,
    anulable: false,
    accion: 'FORCE',
    bucketDestino: RECOMPENSAS,
    cuando: y(op('grupoEn', 'viaje'), op('bucketEs', ESENCIALES), no(op('tagEn', 'viaje-laboral'))),
    mensaje: 'El viaje va a Recompensas.',
    porque:
      'El transporte cotidiano al trabajo es Esencial. Un viaje es Recompensa salvo que sea desplazamiento laboral, y entonces márcalo como tal.',
  },
  {
    id: 'R-07',
    prioridad: 70,
    nucleo: true,
    anulable: false,
    accion: 'FORCE',
    bucketDestino: RECOMPENSAS,
    cuando: y(
      op('grupoEn', 'ropa'),
      op('bucketEs', ESENCIALES, INVERSION),
      no(op('tagEn', 'uniforme', 'epp', 'calzado-seguridad')),
    ),
    mensaje: 'La ropa va a Recompensas.',
    porque:
      'Solo el uniforme, el equipo de protección y el calzado de seguridad son Esenciales. Si esta prenda lo es, márcala con su etiqueta.',
  },
  {
    id: 'R-14',
    prioridad: 80,
    nucleo: true,
    anulable: true,
    // AVISO: no interrumpe ni pide escribir. Mover medio techo a la Cachinha
    // de una vez es lo normal, no algo que haya que justificar. Queda anotado
    // y aparece en el informe del mes, que es donde sirve de algo.
    accion: 'AVISO',
    cuando: y(op('tipoEs', 'gasto'), op('fraccionDelTechoMayorQue', 0.25)),
    mensaje: 'Más de un cuarto del techo de una vez.',
    porque: 'Queda anotado y saldrá en el informe del mes.',
  },
  {
    id: 'R-15',
    prioridad: 85,
    nucleo: true,
    anulable: true,
    accion: 'AVISO',
    cuando: y(op('bucketEs', RECOMPENSAS), op('tipoEs', 'gasto'), op('conteoRecienteAlMenos', RECOMPENSAS, 24, 3)),
    mensaje: 'Tercer capricho en 24 horas.',
    porque: 'No es por el importe, es por el patrón. Solo para que lo veas.',
  },
];

/** Indice por id. */
export const POR_ID = Object.fromEntries(REGLAS_NUCLEO.map((r) => [r.id, r]));

/**
 * Combina las reglas nucleo con las del usuario y las ordena por prioridad.
 * Las de usuario viven en el rango 100-999, siempre por detras del nucleo.
 */
export function componerReglas(reglasUsuario = []) {
  const usuario = reglasUsuario
    .filter((r) => r.activa !== false)
    .map((r) => ({ ...r, nucleo: false, prioridad: Math.max(100, Math.min(999, r.prioridad ?? 500)) }));
  return [...REGLAS_NUCLEO, ...usuario].sort((a, b) => a.prioridad - b.prioridad);
}
