/**
 * Destinos por techo.
 *
 * Antes, elegir un techo abria un selector de categorias. Para Inversion,
 * Reserva y Recompensas eso era preguntar de mas: el dinero va siempre a los
 * mismos dos o tres sitios. Ahora cada techo tiene su lista corta de destinos,
 * y solo «Otro» pide escribir.
 *
 * Esenciales no lleva destinos: mantiene categorias y nota libre.
 *
 * La lista vive en ajustes, no aqui, para que se pueda editar sin tocar codigo.
 * Estos son solo los valores de arranque.
 */

import { ESENCIALES, INVERSION, RESERVA, RECOMPENSAS } from './buckets.js';

export const DESTINOS_POR_DEFECTO = {
  [ESENCIALES]: [],
  [INVERSION]: [
    { id: 'cachinha', nombre: 'Cachinha de Nubank', pideTexto: false },
    { id: 'otro-inversion', nombre: 'Otro tipo de inversión', pideTexto: true, etiquetaTexto: 'Especifica' },
  ],
  [RESERVA]: [{ id: 'cachinha', nombre: 'Cachinha de Nubank', pideTexto: false }],
  [RECOMPENSAS]: [
    { id: 'plan-hotel', nombre: 'Plan de hotel', pideTexto: false },
    { id: 'otro-recompensa', nombre: 'Otro', pideTexto: true, etiquetaTexto: 'Especifica' },
  ],
};

/** Categoria que se asigna segun el destino, para que el historial siga agrupando. */
export const CATEGORIA_DE_DESTINO = {
  cachinha: { [INVERSION]: 'indexado', [RESERVA]: 'emergencia' },
  'otro-inversion': { [INVERSION]: 'broker' },
  'plan-hotel': { [RECOMPENSAS]: 'viaje' },
  'otro-recompensa': { [RECOMPENSAS]: 'ocio' },
};

export function destinosDe(ajustes, bucket) {
  const config = ajustes?.destinos ?? DESTINOS_POR_DEFECTO;
  return config[bucket] ?? [];
}

export function tieneDestinos(ajustes, bucket) {
  return destinosDe(ajustes, bucket).length > 0;
}

export function buscarDestino(ajustes, bucket, destinoId) {
  return destinosDe(ajustes, bucket).find((d) => d.id === destinoId) ?? null;
}

/**
 * Si el techo tiene un solo destino y no pide texto, no hay nada que preguntar:
 * se registra directo. Es el caso de Reserva.
 */
export function destinoAutomatico(ajustes, bucket) {
  const lista = destinosDe(ajustes, bucket);
  if (lista.length === 1 && !lista[0].pideTexto) return lista[0];
  return null;
}

export function categoriaDe(destinoId, bucket) {
  return CATEGORIA_DE_DESTINO[destinoId]?.[bucket] ?? null;
}

/** Etiqueta para el historial: el nombre del destino, o lo que escribio el usuario. */
export function etiquetaDestino(mov, ajustes) {
  if (!mov?.destinoId) return null;
  if (mov.destinoTexto) return mov.destinoTexto;
  return buscarDestino(ajustes, mov.bucket, mov.destinoId)?.nombre ?? mov.destinoId;
}

/** Valida lo que llega del formulario antes de escribir. */
export function validarDestino(ajustes, bucket, destinoId, destinoTexto) {
  const lista = destinosDe(ajustes, bucket);
  if (lista.length === 0) return { ok: true };

  const destino = lista.find((d) => d.id === destinoId);
  if (!destino) return { ok: false, codigo: 'DESTINO_DESCONOCIDO' };
  if (destino.pideTexto && !(destinoTexto ?? '').trim()) {
    return { ok: false, codigo: 'FALTA_ESPECIFICAR', etiqueta: destino.etiquetaTexto ?? 'Especifica' };
  }
  return { ok: true, destino };
}

export { ESENCIALES, INVERSION, RESERVA, RECOMPENSAS };
