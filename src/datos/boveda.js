/**
 * Bóveda: cifrado en reposo del almacén local (§4).
 *
 * Una puerta biométrica que solo tapa la pantalla no protege nada: los datos
 * siguen en IndexedDB, legibles desde las herramientas de desarrollo o desde
 * un respaldo del dispositivo. Aquí Face ID ABRE los datos, porque de la
 * autenticación se deriva la clave que los descifra.
 *
 * Límite honesto del modelo: si el dispositivo está comprometido con la app
 * desbloqueada, la clave está en memoria y los datos son legibles. Protege
 * frente a dispositivo perdido, respaldo robado e inspección del almacén.
 * No protege frente a malware con ejecución en el proceso.
 */

import { CIFRADOS, CAMPOS_EN_CLARO } from './esquema.js';

const SAL_APP = new TextEncoder().encode('finc/v1/prf');
const INFO_HKDF = new TextEncoder().encode('auditor/v1/registros');
const ITERACIONES_PBKDF2 = 600_000;

const enc = new TextEncoder();
const dec = new TextDecoder();

export function haySubtle() {
  try {
    return typeof crypto !== 'undefined' && Boolean(crypto.subtle);
  } catch {
    return false;
  }
}

export function hayWebAuthn() {
  try {
    return typeof PublicKeyCredential !== 'undefined' && typeof navigator?.credentials?.create === 'function';
  } catch {
    return false;
  }
}

function aBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function deBase64(texto) {
  const s = atob(texto);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

function azar(n) {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Deriva la clave de cifrado desde un PIN.
 * PBKDF2 con 600.000 iteraciones: en un iPhone tarda ~1 s, que es aceptable
 * una vez por sesión y caro de repetir un millón de veces por un atacante.
 */
async function claveDesdePin(pin, sal) {
  const material = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: sal, iterations: ITERACIONES_PBKDF2, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Deriva la clave desde el secreto PRF que devuelve el autenticador. */
async function claveDesdePrf(prf, sal) {
  const material = await crypto.subtle.importKey('raw', prf, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: sal, info: INFO_HKDF },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Crea la bóveda. Arranca bloqueada; hay que llamar a abrirConPin o
 * abrirConBiometria antes de leer o escribir nada cifrado.
 */
export function crearBoveda() {
  let clave = null;
  let modo = 'bloqueada'; // bloqueada | pin | biometria | claro
  let temporizador = null;

  const boveda = {
    get modo() {
      return modo;
    },
    get abierta() {
      return modo !== 'bloqueada';
    },
    get cifra() {
      return clave !== null;
    },

    /**
     * Modo sin cifrado. Solo para contextos sin crypto.subtle, que es lo que
     * ocurre al abrir el archivo de prueba desde file:// en algunos navegadores.
     * La interfaz DEBE mostrar un aviso permanente cuando esto está activo.
     */
    abrirEnClaro(motivo = 'CONTEXTO_NO_SEGURO') {
      clave = null;
      modo = 'claro';
      boveda.motivoClaro = motivo;
      return { ok: true, modo, aviso: 'Los datos NO están cifrados en este contexto.' };
    },

    async configurarPin(pin) {
      if (!haySubtle()) return { ok: false, codigo: 'SIN_CRYPTO' };
      if (!/^\d{6}$/.test(pin)) return { ok: false, codigo: 'PIN_INVALIDO' };
      const sal = azar(16);
      const k = await claveDesdePin(pin, sal);
      // Centinela: permite verificar el PIN sin descifrar datos reales.
      const iv = azar(12);
      const centinela = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, enc.encode('auditor-ok'));
      clave = k;
      modo = 'pin';
      return {
        ok: true,
        config: { sal: aBase64(sal), iv: aBase64(iv), centinela: aBase64(centinela), metodo: 'pin' },
      };
    },

    async abrirConPin(pin, config) {
      if (!haySubtle()) return { ok: false, codigo: 'SIN_CRYPTO' };
      if (!config?.sal) return { ok: false, codigo: 'SIN_CONFIGURAR' };
      try {
        const k = await claveDesdePin(pin, deBase64(config.sal));
        const abierto = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: deBase64(config.iv) },
          k,
          deBase64(config.centinela),
        );
        if (dec.decode(abierto) !== 'auditor-ok') return { ok: false, codigo: 'PIN_INCORRECTO' };
        clave = k;
        modo = 'pin';
        return { ok: true };
      } catch {
        return { ok: false, codigo: 'PIN_INCORRECTO' };
      }
    },

    /**
     * Registra una credencial de plataforma con la extensión PRF.
     * Si el autenticador no soporta PRF se devuelve SIN_PRF y la app se queda
     * con el PIN: detección en tiempo de ejecución, nunca por versión de
     * agente de usuario.
     */
    async registrarBiometria({ nombreUsuario = 'finc' } = {}) {
      if (!hayWebAuthn() || !haySubtle()) return { ok: false, codigo: 'SIN_WEBAUTHN' };
      try {
        const credencial = await navigator.credentials.create({
          publicKey: {
            challenge: azar(32),
            rp: { name: 'finc' },
            user: { id: azar(16), name: nombreUsuario, displayName: nombreUsuario },
            pubKeyCredParams: [
              { type: 'public-key', alg: -7 },
              { type: 'public-key', alg: -257 },
            ],
            authenticatorSelection: {
              authenticatorAttachment: 'platform',
              userVerification: 'required',
              residentKey: 'required',
            },
            timeout: 60_000,
            extensions: { prf: { eval: { first: SAL_APP } } },
          },
        });

        const ext = credencial.getClientExtensionResults?.();
        if (!ext?.prf?.enabled) return { ok: false, codigo: 'SIN_PRF', credId: aBase64(credencial.rawId) };

        return { ok: true, config: { credId: aBase64(credencial.rawId), sal: aBase64(azar(16)), metodo: 'prf' } };
      } catch (e) {
        return { ok: false, codigo: 'RECHAZADO', detalle: e?.name };
      }
    },

    async abrirConBiometria(config) {
      if (!hayWebAuthn() || !haySubtle()) return { ok: false, codigo: 'SIN_WEBAUTHN' };
      if (!config?.credId) return { ok: false, codigo: 'SIN_CONFIGURAR' };
      try {
        const assertion = await navigator.credentials.get({
          publicKey: {
            challenge: azar(32),
            allowCredentials: [{ id: deBase64(config.credId), type: 'public-key' }],
            userVerification: 'required',
            timeout: 60_000,
            extensions: { prf: { eval: { first: SAL_APP } } },
          },
        });

        const prf = assertion.getClientExtensionResults?.()?.prf?.results?.first;
        if (!prf) return { ok: false, codigo: 'SIN_PRF' };

        clave = await claveDesdePrf(prf, deBase64(config.sal));
        modo = 'biometria';
        return { ok: true };
      } catch (e) {
        return { ok: false, codigo: 'RECHAZADO', detalle: e?.name };
      }
    },

    cerrar() {
      clave = null;
      modo = 'bloqueada';
      if (temporizador) clearTimeout(temporizador);
    },

    /** Descarta la clave a los N segundos en segundo plano (§4). */
    programarBloqueo(segundos = 120, alBloquear) {
      if (temporizador) clearTimeout(temporizador);
      temporizador = setTimeout(() => {
        boveda.cerrar();
        alBloquear?.();
      }, segundos * 1000);
    },

    cancelarBloqueo() {
      if (temporizador) clearTimeout(temporizador);
      temporizador = null;
    },

    /**
     * Sella un registro: deja en claro las claves de índice y cifra el resto.
     * El encabezado revela que existió UN movimiento de Esenciales en
     * septiembre, nunca de cuánto ni de qué.
     */
    async sellar(almacen, registro) {
      if (!clave || !CIFRADOS.has(almacen)) return registro;

      const enClaro = CAMPOS_EN_CLARO[almacen] ?? Object.keys(registro).filter((k) => k === 'id' || k === 'key');
      const cabecera = {};
      const cuerpo = {};
      for (const [k, v] of Object.entries(registro)) {
        if (enClaro.includes(k)) cabecera[k] = v;
        else cuerpo[k] = v;
      }

      const iv = azar(12);
      const cifrado = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, clave, enc.encode(JSON.stringify(cuerpo)));
      return { ...cabecera, _iv: aBase64(iv), _c: aBase64(cifrado) };
    },

    async abrirRegistro(almacen, registro) {
      if (!registro) return registro;
      if (!registro._c) return registro; // guardado sin cifrar
      if (!clave) throw new Error('BOVEDA_BLOQUEADA');

      const { _iv, _c, ...cabecera } = registro;
      const abierto = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: deBase64(_iv) },
        clave,
        deBase64(_c),
      );
      return { ...cabecera, ...JSON.parse(dec.decode(abierto)) };
    },

    async abrirVarios(almacen, registros) {
      return Promise.all(registros.map((r) => boveda.abrirRegistro(almacen, r)));
    },
  };

  return boveda;
}

/** Bóveda inerte: pasa los registros tal cual. La usan los tests de Node. */
export function crearBovedaInerte() {
  return {
    modo: 'claro',
    abierta: true,
    cifra: false,
    abrirEnClaro: () => ({ ok: true, modo: 'claro' }),
    cerrar() {},
    programarBloqueo() {},
    cancelarBloqueo() {},
    async sellar(_a, r) {
      return r;
    },
    async abrirRegistro(_a, r) {
      return r;
    },
    async abrirVarios(_a, rs) {
      return rs;
    },
  };
}
