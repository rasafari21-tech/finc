/**
 * Service Worker (§3).
 *
 * Sirve exclusivamente el shell. NO cachea ni un solo dato financiero, porque
 * no existe ninguna peticion de red que devuelva datos del usuario: IndexedDB
 * es la fuente de verdad y el dominio nunca sale del dispositivo.
 */

const VERSION = 'v6';
const SHELL = `shell-${VERSION}`;
const ASSETS = `assets-${VERSION}`;

const PRECARGA = [
  './',
  './index.html',
  './manifest.webmanifest',
  './estilos/app.css?v=4',
  './src/app/main.js?v=4',
  './src/app/comandos.js',
  './src/app/estado.js',
  './src/app/reloj.js',
  './src/datos/esquema.js',
  './src/datos/motor-idb.js',
  './src/datos/motor-memoria.js',
  './src/datos/boveda.js',
  './src/datos/repo.js',
  './src/dominio/dinero.js',
  './src/dominio/buckets.js',
  './src/dominio/reparto.js',
  './src/dominio/predicados.js',
  './src/dominio/reglas.js',
  './src/dominio/clasificador.js',
  './src/dominio/categorias.js',
  './src/dominio/periodo.js',
  './src/dominio/cierre.js',
  './src/dominio/carry.js',
  './src/dominio/diagnostico.js',
  './src/dominio/redondeo.js',
  './src/dominio/informales.js',
  './src/dominio/destinos.js',
  './src/dominio/sobrante.js',
  './src/ui/componentes.js',
  './src/ui/hojas.js',
  './iconos/icono-180.png',
  './iconos/icono-192.png',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(SHELL).then((cache) =>
      // addAll falla entero si un recurso falla; se añaden de uno en uno para
      // que un icono ausente no impida instalar el Service Worker.
      Promise.all(PRECARGA.map((url) => cache.add(url).catch(() => null))),
    ),
  );
  // Sin skipWaiting(): el worker nuevo espera. Una recarga automatica mientras
  // alguien teclea un importe destruye trabajo, y aqui el registro dura 3 s.
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    (async () => {
      const vivos = [SHELL, ASSETS];
      for (const clave of await caches.keys()) {
        if (!vivos.includes(clave)) await caches.delete(clave);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (evento) => {
  if (evento.data?.type === 'ACTIVAR_AHORA') self.skipWaiting();
});

self.addEventListener('fetch', (evento) => {
  const peticion = evento.request;
  if (peticion.method !== 'GET') return;

  const url = new URL(peticion.url);
  if (url.origin !== location.origin) return;

  // Navegacion: cache-first sobre el shell, pero SOLO para las rutas de la
  // propia app. Devolver index.html ante cualquier navegacion secuestra
  // cualquier otra pagina del mismo origen —prueba.html, sin ir mas lejos— y
  // el usuario ve la app creyendo que abrio otra cosa.
  const ESTA_APP = new Set(['/', '/index.html']);
  const raizScope = new URL('./', self.registration.scope).pathname;
  const rutaRelativa = url.pathname.startsWith(raizScope)
    ? `/${url.pathname.slice(raizScope.length)}`
    : url.pathname;

  if (peticion.mode === 'navigate' && ESTA_APP.has(rutaRelativa)) {
    evento.respondWith(
      (async () => {
        const cacheado = await caches.match('./index.html');
        if (cacheado) {
          // Revalidacion en segundo plano: nunca bloquea la respuesta.
          evento.waitUntil(
            fetch(peticion)
              .then((red) => red.ok && caches.open(SHELL).then((c) => c.put('./index.html', red.clone())))
              .catch(() => null),
          );
          return cacheado;
        }
        try {
          return await fetch(peticion);
        } catch {
          return new Response('<h1>Sin conexión y sin copia local</h1>', {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
            status: 503,
          });
        }
      })(),
    );
    return;
  }

  // Resto de recursos del propio origen: cache-first.
  evento.respondWith(
    (async () => {
      const cacheado = await caches.match(peticion);
      if (cacheado) return cacheado;
      try {
        const red = await fetch(peticion);
        if (red.ok) {
          const cache = await caches.open(ASSETS);
          cache.put(peticion, red.clone());
        }
        return red;
      } catch (e) {
        return new Response('', { status: 504 });
      }
    })(),
  );
});

/**
 * Web Push: el servidor manda un identificador de plantilla, nunca cifras.
 * Los importes los rellena este handler leyendo IndexedDB EN el dispositivo.
 */
self.addEventListener('push', (evento) => {
  evento.waitUntil(
    (async () => {
      let plantilla = 'GENERICO';
      try {
        plantilla = evento.data?.json()?.plantilla ?? 'GENERICO';
      } catch {
        /* cuerpo no valido: se usa la plantilla generica */
      }

      const textos = {
        ANCLAR_SALDO: ['Nuevo ciclo abierto', 'Ancla tu saldo con el extracto del banco.'],
        CIERRE_LISTO: ['Tu informe está listo', 'Mira cómo cerró el mes.'],
        SUBFINANCIADO: ['Revisión de fondo', 'Tu 50 % de Esenciales no alcanza.'],
        GENERICO: ['finc', 'Tienes algo pendiente.'],
      };
      const [titulo, cuerpo] = textos[plantilla] ?? textos.GENERICO;

      await self.registration.showNotification(titulo, {
        body: cuerpo,
        icon: './iconos/icono-180.png',
        badge: './iconos/icono-180.png',
        tag: plantilla,
        data: { plantilla },
      });
    })(),
  );
});

self.addEventListener('notificationclick', (evento) => {
  evento.notification.close();
  evento.waitUntil(
    (async () => {
      const clientes = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (clientes.length) return clientes[0].focus();
      return self.clients.openWindow('./');
    })(),
  );
});
