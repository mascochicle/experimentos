# Vigía del Golfo

Ciclones tropicales activos, lluvia y tormentas en vivo sobre el Golfo, el Caribe y el
Pacífico mexicano — con la distancia y el rumbo respecto a Campeche.

## El truco: GitHub Actions hace de servidor

El National Hurricane Center publica los ciclones activos en
[`CurrentStorms.json`](https://www.nhc.noaa.gov/CurrentStorms.json), pero **no manda
cabecera CORS**: un navegador no puede leer ese archivo directamente. Por eso muchos
rastreadores dependen de proxies públicos que se caen.

Aquí no hay proxy. El workflow [`actualizar-tormentas.yml`](.github/workflows/actualizar-tormentas.yml)
baja el feed **desde el servidor de GitHub** (donde CORS no aplica) cada 30 minutos y lo
deja en [`datos/tormentas.json`](datos/tormentas.json), dentro del propio repo. La página
lee su propio archivo — mismo origen, sin llaves, sin backend que pagar ni mantener.

Ventaja extra: si algo falla, queda en los logs de Actions, que sí se pueden leer y
depurar.

El mismo workflow baja el **Tropical Weather Outlook**, que el NHC solo publica como un
ZIP de shapefiles. Para no instalar GDAL en cada corrida,
[`vigilancia.mjs`](.github/scripts/vigilancia.mjs) trae un lector de shapefile y dBASE
escrito a mano, sin dependencias, y deja el resultado en
[`datos/vigilancia.json`](datos/vigilancia.json). De paso simplifica los polígonos de 300
vértices a unos 30, que a escala de continente se ven igual y pesan siete veces menos.

## Qué muestra

- **Mapa oscuro** — teselas de OpenStreetMap, invertidas por CSS
- **Radar de lluvia animado** — [RainViewer](https://www.rainviewer.com/), últimas ~2 h más
  pronóstico corto, en la paleta NEXRAD Level III (verde→rojo), que es la que contrasta
  sobre el mapa oscuro
- **Ciclones activos** — posición, categoría Saffir-Simpson, vientos en km/h y presión
- **Distancia y rumbo a Campeche** por cada sistema, con tres niveles:
  - 🔴 apunta hacia acá y está a menos de 1,500 km
  - 🟡 apunta en esta dirección pero está lejos
  - 🟢 su rumbo no apunta hacia Campeche
- **Zonas en vigilancia** — las áreas donde el NHC ve posibilidad de que se forme un
  ciclón, con su probabilidad a 48 horas y a 7 días, dibujadas sobre el mapa en los
  mismos colores del NHC. Aparecen **antes** de que la tormenta exista y tenga nombre,
  así que son el aviso más temprano que hay
- **Liga al cono oficial del NHC** de cada tormenta, y al pronóstico completo de cada zona

> El semáforo es **geometría del rumbo de este momento, no un pronóstico**. El cono
> oficial del NHC es la fuente que manda; por eso cada tarjeta liga directo a él.

## Publicarlo (GitHub Pages, gratis)

1. `Settings → Pages`
2. Source: **Deploy from a branch** → rama `main`, carpeta `/ (root)` → **Save**
3. Queda en `https://mascochicle.github.io/experimentos/`

El repo debe ser **público** para que Pages funcione en el plan gratuito.

## Correrlo local

```bash
python3 -m http.server 8000
# abre http://localhost:8000
```

Debe servirse por HTTP: con `file://` el navegador bloquea la lectura de
`datos/tormentas.json`.

## Créditos

OpenStreetMap contributors · RainViewer · NOAA / National Hurricane Center.
Datos de dominio público; esta página no es un aviso oficial.
