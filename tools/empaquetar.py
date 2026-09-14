"""Genera `prueba.html`: la app entera en un solo archivo, mas el panel de pruebas.

Por que existe este script y no un segundo HTML escrito a mano: dos copias del
mismo codigo divergen en dos dias. Aqui el archivo de prueba se DERIVA del
codigo real, asi que «identico» esta garantizado por construccion. Cambias la
app, vuelves a ejecutar esto, y la prueba refleja el cambio.

Como funciona: los modulos ES se transforman en un registro con un `__req`
minimo. No se usan blobs ni import maps porque ninguno de los dos funciona de
forma fiable al abrir un archivo con file://, que es justo el caso de uso.
"""

import os
import posixpath
import re
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)

ENTRADAS = ["src/app/main.js", "tools/panel-pruebas.js"]
SALIDA = "prueba.html"


def leer(ruta_rel):
    with open(os.path.join(RAIZ, ruta_rel), encoding="utf-8") as f:
        return f.read()


def resolver(desde_rel, especificador):
    """Convierte una ruta relativa de import en un id canonico del proyecto."""
    if not especificador.startswith("."):
        raise ValueError(f"Import no relativo sin resolver: {especificador} (en {desde_rel})")
    base = posixpath.dirname(desde_rel.replace("\\", "/"))
    return posixpath.normpath(posixpath.join(base, especificador))


def transformar(id_modulo, fuente):
    """Reescribe imports y exports a la forma del registro. Devuelve (codigo, exportados, dependencias)."""
    exportados = []   # (nombre_expuesto, identificador_local)
    dependencias = []

    def registrar_dep(especificador):
        destino = resolver(id_modulo, especificador)
        dependencias.append(destino)
        return destino

    # import { a, b as c } from './x.js';
    def repl_import(m):
        nombres, especificador = m.group(1), m.group(2)
        destino = registrar_dep(especificador)
        nombres = re.sub(r"(\w+)\s+as\s+(\w+)", r"\1: \2", nombres).strip()
        return f"const {{ {nombres} }} = __req('{destino}');"

    fuente = re.sub(
        r"import\s*\{([^}]*)\}\s*from\s*['\"]([^'\"]+)['\"]\s*;?",
        repl_import,
        fuente,
    )

    # import './x.js';  (solo efectos secundarios)
    def repl_import_efecto(m):
        destino = registrar_dep(m.group(1))
        return f"__req('{destino}');"

    fuente = re.sub(r"import\s+['\"]([^'\"]+)['\"]\s*;?", repl_import_efecto, fuente)

    # await import('./x.js')  ->  __req('x')
    def repl_dinamico(m):
        destino = registrar_dep(m.group(1))
        return f"__req('{destino}')"

    fuente = re.sub(
        r"await\s+import\(\s*['\"]([^'\"]+)['\"]\s*\)", repl_dinamico, fuente
    )

    # export { a, b as c };
    def repl_export_lista(m):
        for pieza in m.group(1).split(","):
            pieza = pieza.strip()
            if not pieza:
                continue
            if " as " in pieza:
                local, expuesto = (p.strip() for p in pieza.split(" as "))
            else:
                local = expuesto = pieza
            exportados.append((expuesto, local))
        return ""

    fuente = re.sub(r"export\s*\{([^}]*)\}\s*;?", repl_export_lista, fuente)

    # export function / async function / const / let / class
    def repl_export_decl(m):
        exportados.append((m.group(2), m.group(2)))
        return m.group(1)

    fuente = re.sub(
        r"export\s+((?:async\s+)?function\s*\*?\s*(\w+))", repl_export_decl, fuente
    )
    fuente = re.sub(r"export\s+((?:const|let|var)\s+(\w+))", repl_export_decl, fuente)
    fuente = re.sub(r"export\s+(class\s+(\w+))", repl_export_decl, fuente)

    sobrantes = re.findall(r"^\s*export\s+", fuente, re.M)
    if sobrantes:
        raise ValueError(f"{id_modulo}: quedaron {len(sobrantes)} export sin transformar")
    sobrantes = re.findall(r"^\s*import\s+", fuente, re.M)
    if sobrantes:
        raise ValueError(f"{id_modulo}: quedaron {len(sobrantes)} import sin transformar")

    asignaciones = "\n".join(
        f"  __e.{expuesto} = {local};" for expuesto, local in exportados
    )
    codigo = f"__m['{id_modulo}'] = function (__e, __req) {{\n{fuente}\n{asignaciones}\n}};"
    return codigo, exportados, dependencias


def recolectar(entradas):
    """Recorre el grafo de modulos desde las entradas."""
    vistos = {}
    orden = []
    pendientes = list(entradas)

    while pendientes:
        id_modulo = pendientes.pop(0)
        if id_modulo in vistos:
            continue
        try:
            fuente = leer(id_modulo)
        except FileNotFoundError:
            raise SystemExit(f"No encuentro el modulo {id_modulo}")
        codigo, _, deps = transformar(id_modulo, fuente)
        vistos[id_modulo] = codigo
        orden.append(id_modulo)
        pendientes.extend(d for d in deps if d not in vistos)

    return orden, vistos


RUNTIME = """
/* Registro de modulos. Sustituye al cargador de ES modules, que no funciona
   desde file://. El cache se rellena ANTES de ejecutar el modulo para que una
   dependencia circular no se quede en bucle. */
const __m = {};
const __c = {};
function __req(id) {
  if (__c[id]) return __c[id];
  const e = {};
  __c[id] = e;
  if (!__m[id]) throw new Error('Modulo no empaquetado: ' + id);
  __m[id](e, __req);
  return e;
}
"""

AVISO = """
<div id="aviso-prueba">
  <b>Archivo de prueba</b> — misma lógica que la app real, generado desde su código.
  <span id="aviso-detalle"></span>
</div>
<style>
  #aviso-prueba { position: fixed; top: 0; left: 0; right: 0; z-index: 998;
    background: #7f5c12; color: #fff; font-size: 11.5px; line-height: 1.35;
    padding: 5px 12px; text-align: center;
    font-family: ui-monospace, Menlo, monospace; }
  #aviso-prueba b { font-weight: 700; }
  #app { padding-top: 28px; }
</style>
<script>
  window.addEventListener('DOMContentLoaded', function () {
    var d = document.getElementById('aviso-detalle');
    if (!d) return;
    var partes = [];
    if (location.protocol === 'file:') partes.push('sin Service Worker');
    if (!(window.crypto && window.crypto.subtle)) partes.push('SIN CIFRADO');
    if (partes.length) d.textContent = ' · ' + partes.join(' · ');
  });
</script>
"""


def main():
    orden, modulos = recolectar(ENTRADAS)

    css = leer("estilos/app.css")
    html = leer("index.html")

    # Cuerpo del index sin las etiquetas que vamos a sustituir.
    cuerpo = re.search(r"<body>(.*?)</body>", html, re.S)
    if not cuerpo:
        raise SystemExit("index.html no tiene <body>")
    cuerpo = cuerpo.group(1)
    cuerpo = re.sub(r"<script[^>]*type=\"module\"[^>]*></script>", "", cuerpo)
    cuerpo = re.sub(r"<noscript>.*?</noscript>", "", cuerpo, flags=re.S)

    bundle = "\n\n".join(modulos[i] for i in orden)
    arranque = "\n".join(f"__req('{e}');" for e in ENTRADAS)

    salida = f"""<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1">
<title>finc · prueba</title>
<meta name="theme-color" content="#f2f3f6">
<style>
{css}
</style>
</head>
<body>
{AVISO}
{cuerpo}
<script>
(function () {{
'use strict';
{RUNTIME}
{bundle}

{arranque}
}})();
</script>
</body>
</html>
"""

    destino = os.path.join(RAIZ, SALIDA)
    with open(destino, "w", encoding="utf-8") as f:
        f.write(salida)

    tam = os.path.getsize(destino)
    print(f"  {SALIDA}  ({tam // 1024} kB, {len(orden)} módulos)")
    for i in orden:
        print(f"    · {i}")


if __name__ == "__main__":
    try:
        main()
    except ValueError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
