/**
 * Catalogo base de categorias.
 *
 * El `grupo` es lo que consultan las reglas: permite escribir «cualquier cosa
 * del grupo ropa» sin enumerar categorias, de modo que añadir una categoria
 * nueva no obliga a tocar el motor de reglas.
 *
 * `defaultBucket` es la sugerencia, no la ley. La ley son las reglas de §7.2.
 */

import { ESENCIALES, INVERSION, RESERVA, RECOMPENSAS } from './buckets.js';

function cat(id, nombre, grupo, defaultBucket, keywords = []) {
  return { id, nombre, grupo, defaultBucket, keywords };
}

export const CATALOGO = [
  // --- Esenciales ---------------------------------------------------------
  cat('vivienda', 'Alquiler o hipoteca', 'vivienda', ESENCIALES, ['alquiler', 'renta', 'hipoteca']),
  cat('servicios', 'Luz, agua, gas', 'servicios', ESENCIALES, ['luz', 'agua', 'gas', 'electricidad']),
  cat('internet', 'Internet y telefonía', 'servicios', ESENCIALES, ['internet', 'telefono', 'movil']),
  cat('mercado', 'Supermercado', 'mercado', ESENCIALES, ['supermercado', 'mercado', 'compra']),
  cat('transporte', 'Transporte al trabajo', 'transporte', ESENCIALES, ['bus', 'metro', 'gasolina', 'combustible']),
  cat('salud', 'Salud y medicamentos', 'salud', ESENCIALES, ['medico', 'farmacia', 'medicamento']),
  cat('seguros', 'Seguros', 'seguros', ESENCIALES, ['seguro', 'poliza']),
  cat('deuda-minimo', 'Deuda: pago mínimo', 'deuda', ESENCIALES, ['cuota', 'minimo', 'tarjeta']),
  cat('educacion', 'Educación obligatoria', 'educacion', ESENCIALES, ['colegio', 'matricula']),
  cat('higiene', 'Higiene básica', 'higiene', ESENCIALES, ['jabon', 'pasta', 'papel']),
  cat('mascota-salud', 'Mascota: comida y veterinario', 'mascota-esencial', ESENCIALES, ['veterinario', 'pienso']),
  cat('uniforme', 'Uniforme o equipo de protección', 'ropa-laboral', ESENCIALES, ['uniforme', 'epp', 'botas']),

  // --- Inversion ----------------------------------------------------------
  cat('broker', 'Aporte a bróker', 'inversion', INVERSION, ['broker', 'acciones', 'bolsa']),
  cat('indexado', 'Fondo indexado', 'inversion', INVERSION, ['indexado', 'etf', 'fondo']),
  cat('pension', 'Plan de pensiones', 'inversion', INVERSION, ['pension', 'jubilacion']),
  cat('negocio', 'Capital de negocio', 'inversion', INVERSION, ['negocio', 'capital', 'stock']),
  cat('deuda-extra', 'Deuda: amortización extra', 'amortizacion', INVERSION, ['amortizar', 'adelanto']),
  cat('formacion', 'Formación profesional', 'formacion', INVERSION, ['curso', 'certificacion', 'master']),
  cat('herramienta', 'Herramienta de trabajo', 'gadget', INVERSION, ['ordenador', 'portatil', 'herramienta']),
  cat('cripto', 'Criptoactivo', 'cripto-especulativo', RECOMPENSAS, ['cripto', 'bitcoin', 'token']),

  // --- Reserva ------------------------------------------------------------
  cat('emergencia', 'Emergencia', 'reserva', RESERVA, ['emergencia', 'urgencia']),
  cat('reparacion', 'Reparación imprevista', 'reserva', RESERVA, ['reparacion', 'averia', 'taller']),
  cat('mantenimiento', 'Mantenimiento preventivo', 'reserva', RESERVA, ['mantenimiento', 'revision']),

  // --- Recompensas --------------------------------------------------------
  cat('restaurante', 'Restaurante o delivery', 'restaurante', RECOMPENSAS, ['restaurante', 'delivery', 'cena']),
  cat('ropa', 'Ropa y calzado', 'ropa', RECOMPENSAS, ['ropa', 'zapatos', 'camisa', 'abrigo']),
  cat('regalo', 'Regalo', 'regalo', RECOMPENSAS, ['regalo', 'cumpleanos', 'flores', 'joya']),
  cat('viaje', 'Viaje', 'viaje', RECOMPENSAS, ['viaje', 'hotel', 'vuelo']),
  cat('suscripcion', 'Suscripción de entretenimiento', 'suscripcion', RECOMPENSAS, ['netflix', 'spotify', 'streaming']),
  cat('gadget', 'Electrónica y gadgets', 'gadget', RECOMPENSAS, ['movil', 'auriculares', 'consola']),
  cat('belleza', 'Estética y belleza', 'belleza', RECOMPENSAS, ['peluqueria', 'estetica', 'unas']),
  cat('apuesta', 'Apuestas y lotería', 'apuesta', RECOMPENSAS, ['apuesta', 'loteria', 'casino']),
  cat('mascota-extra', 'Mascota: accesorios y juguetes', 'mascota-accesorio', RECOMPENSAS, ['juguete', 'collar']),
  cat('ocio', 'Ocio y salidas', 'ocio', RECOMPENSAS, ['cine', 'concierto', 'bar']),

  // --- Ingresos -----------------------------------------------------------
  cat('atencion', 'Cita o atención', 'ingreso', null, ['cita', 'atencion', 'consulta', 'sesion']),
  cat('nomina', 'Nómina', 'ingreso', null, ['nomina', 'sueldo', 'salario']),
  cat('otro-ingreso', 'Otro ingreso', 'ingreso', null, ['ingreso', 'extra']),
];

/** Indice por id, que es lo que consume el evaluador de predicados. */
export const POR_ID = Object.fromEntries(CATALOGO.map((c) => [c.id, c]));

/** Categorias de gasto de un bucket, para los selectores de la interfaz. */
export function deBucket(bucket) {
  return CATALOGO.filter((c) => c.defaultBucket === bucket);
}

/** Categorias de ingreso. */
export function deIngreso() {
  return CATALOGO.filter((c) => c.grupo === 'ingreso');
}

/**
 * Sugerencia por palabra clave (§7.4, tercera fuente).
 * Devuelve la categoria cuyo nombre o keywords casan con el texto.
 */
export function sugerirPorTexto(texto) {
  if (!texto) return null;
  const t = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  for (const c of CATALOGO) {
    if (c.grupo === 'ingreso') continue;
    if (c.keywords.some((k) => t.includes(k))) return c;
    if (t.includes(c.nombre.toLowerCase().split(' ')[0])) return c;
  }
  return null;
}

/** Codigos de retirada de Reserva admitidos por R-08. */
export const RAZONES_RESERVA = [
  { id: 'SALUD', nombre: 'Salud' },
  { id: 'REPARACION', nombre: 'Reparación' },
  { id: 'DESEMPLEO', nombre: 'Desempleo' },
  { id: 'LEGAL', nombre: 'Legal' },
  { id: 'OTRO_JUSTIFICADO', nombre: 'Otro, justificado' },
];
