# Notas para Claude

Repo de experimentos de Marco (Campeche, México). **Contéstale en español.**

Ahorita contiene un solo proyecto: **Vigía del Golfo** — rastreador de ciclones
tropicales y lluvia, con la distancia y el rumbo respecto a Campeche.
Ver [README.md](README.md) para qué hace y cómo publicarlo.

## La decisión de arquitectura que manda aquí

**GitHub Actions hace de servidor.** No hay backend, no hay llaves, no hay proxy.

`.github/workflows/actualizar-tormentas.yml` baja el feed del NHC desde el runner,
lo traduce a español y lo comitea como `datos/tormentas.json`. La página lee su
propio archivo, mismo origen.

Esto no fue por elegancia: **`www.nhc.noaa.gov` no manda cabecera CORS** en
`CurrentStorms.json`, así que un navegador no puede leerlo directo. Los
rastreadores que dependen de proxies públicos se caen cuando el proxy se cae.

Ventaja secundaria que importa mucho en la práctica: si algo truena, queda en los
logs de Actions, que sí se pueden leer y depurar. Un backend desplegado en otro
lado normalmente **no** se puede inspeccionar desde una sesión en la nube.

Antes de meter cualquier fuente de datos nueva, la pregunta es: *¿manda CORS?*
Si no, va por Actions igual que esta. No inventes un proxy.

## Cosas verificadas — no las vuelvas a adivinar

- **Formato de tesela de RainViewer**:
  `{host}{path}/{size}/{z}/{x}/{y}/{color}/{smooth}_{snow}.png`, con
  `maxNativeZoom: 7`. El manifiesto vive en
  `https://api.rainviewer.com/public/weather-maps.json` y trae `host` más
  `radar.past[]` / `radar.nowcast[]`.
- **Paletas de RainViewer** (el número va literal en la URL):
  2 = Universal Blue · 4 = TWC · 6 = NEXRAD Level III · 8 = Dark Sky.
  Aquí está fija en **6**: el extremo bajo de la 2 se pierde contra el mapa
  oscuro y la lluvia ligera quedaba invisible. Marco eligió la 6; no la cambies
  sin preguntarle.
- **El basemap oscuro** son teselas normales de OpenStreetMap en su propio pane
  (`basePane`, zIndex 150) con un `filter: invert()` de CSS. Va en pane aparte
  a propósito, para que la inversión **no** toque los colores del radar.
- **CARTO ya no sirve sin llave**: sus teselas oscuras ahora salen con marca de
  agua "API KEY REQUIRED" y sin mar. Por eso el truco del invert.
- **Campos del NHC** que usa el workflow: `id`, `name`, `classification`,
  `binNumber`, `intensity` (kt), `pressure`, `latitudeNumeric`,
  `longitudeNumeric`, `movementDir`, `movementSpeed`, `lastUpdate`,
  `publicAdvisory.url`, `forecastGraphics.url`.

## El semáforo de rumbo

Cada tarjeta compara el rumbo actual del ciclón contra el azimut de regreso a
Campeche. Tres niveles: apunta y está a menos de 1,500 km (rojo) · apunta pero
lejos (amarillo) · no apunta (verde).

**Es geometría del rumbo de este momento, no un pronóstico de trayectoria.** El
cono oficial del NHC es la fuente que manda, y por eso cada tarjeta liga directo
a él. Si tocas esta lógica, no la conviertas en algo que parezca un pronóstico.
Empezó siendo un sí/no y alarmaba en rojo por una tormenta a 3,200 km.

## Cómo probar sin publicar

```bash
python3 -m http.server 8000   # http://localhost:8000
```

Tiene que ser por HTTP: con `file://` el navegador bloquea la lectura de
`datos/tormentas.json`.

Para probar la lógica de las tarjetas sin depender de que haya ciclones reales,
edita `datos/tormentas.json` a mano con tormentas inventadas. El workflow lo
sobrescribe en su próxima corrida, así que no te preocupes por ensuciarlo.

## Límites del entorno

- **Pages requiere que el repo sea público** en el plan gratuito. Ya lo es.
- **Marco es el único que puede tocar Settings** (prender Pages, crear o borrar
  repos). Desde una sesión no se puede — da 403. Pídeselo, no lo intentes.
- Desde una sesión **en la nube** casi toda la salida a internet está bloqueada
  (rainviewer, github.io, tiles de OSM). Se puede leer la API de GitHub y los
  logs de Actions, y eso alcanza para depurar el backend. Para ver la página
  renderizada de verdad hace falta o una sesión local, o una captura de Marco.
