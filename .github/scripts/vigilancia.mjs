// Arma datos/vigilancia.json a partir del Graphical Tropical Weather Outlook del NHC.
//
// El NHC publica el GTWO como un ZIP de shapefiles (gtwo_shapefiles.zip). No hay
// GeoJSON ni KML equivalente: se probaron gtwo_areas.kml, gtwo.kmz y gtwo.php y los
// tres dan 404. Así que aquí va un lector de shapefile + dBASE escrito a mano.
//
// Se hace a mano a propósito: el formato shapefile está congelado desde 1998 y son
// ~100 líneas, contra instalar gdal-bin (apt-get de ~1 min) en cada corrida de media
// hora. Sin dependencias, igual que el resto del proyecto.
//
// Uso:  node vigilancia.mjs <carpeta-con-el-zip-extraido> <archivo-de-salida>

import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------- shapefile
// Header de 100 bytes; luego registros con cabecera de 8 bytes (big-endian) y
// contenido little-endian. Solo interesan Point (1) y Polygon (5).
function leerShp(buf) {
  const formas = [];
  let p = 100;
  while (p + 8 <= buf.length) {
    const largoContenido = buf.readInt32BE(p + 4) * 2; // viene en palabras de 16 bits
    const ini = p + 8;
    if (ini + largoContenido > buf.length) break;
    const tipo = buf.readInt32LE(ini);

    if (tipo === 1) {
      // Point: x, y
      formas.push({ tipo: "punto", lon: buf.readDoubleLE(ini + 4), lat: buf.readDoubleLE(ini + 12) });
    } else if (tipo === 5) {
      // Polygon: bbox(4 doubles) . numParts . numPoints . parts[] . points[]
      const numPartes = buf.readInt32LE(ini + 36);
      const numPuntos = buf.readInt32LE(ini + 40);
      const inicioPartes = ini + 44;
      const inicioPuntos = inicioPartes + numPartes * 4;
      const cortes = [];
      for (let i = 0; i < numPartes; i++) cortes.push(buf.readInt32LE(inicioPartes + i * 4));
      cortes.push(numPuntos);

      const anillos = [];
      for (let i = 0; i < numPartes; i++) {
        const anillo = [];
        for (let j = cortes[i]; j < cortes[i + 1]; j++) {
          const o = inicioPuntos + j * 16;
          // Leaflet quiere [lat, lon]; se guarda así para que la página no convierta nada.
          // Dos decimales son ~1 km: de sobra para áreas de varios cientos de km, y
          // hace la diferencia en un archivo que se comitea cada media hora.
          const par = [
            +buf.readDoubleLE(o + 8).toFixed(2),
            +buf.readDoubleLE(o).toFixed(2)
          ];
          const previo = anillo[anillo.length - 1];
          if (previo && previo[0] === par[0] && previo[1] === par[1]) continue; // redondeo duplicado
          anillo.push(par);
        }
        // Cerrar el anillo si el redondeo separó el último punto del primero.
        if (anillo.length >= 3) {
          const a = anillo[0];
          const z = anillo[anillo.length - 1];
          if (a[0] !== z[0] || a[1] !== z[1]) anillo.push([a[0], a[1]]);
          anillos.push(anillo);
        }
      }
      formas.push({ tipo: "poligono", anillos });
    } else {
      // Shape nulo u otro tipo: se guarda el hueco para no desalinear con el DBF.
      formas.push(null);
    }
    p = ini + largoContenido;
  }
  return formas;
}

// -------------------------------------------------------------------- dBASE
// Cabecera de 32 bytes, descriptores de campo de 32 bytes terminados en 0x0D, y
// luego registros de ancho fijo. Los campos del GTWO son todos texto.
function leerDbf(buf) {
  const numRegistros = buf.readUInt32LE(4);
  const largoCabecera = buf.readUInt16LE(8);
  const largoRegistro = buf.readUInt16LE(10);

  const campos = [];
  for (let p = 32; p < largoCabecera - 1 && buf[p] !== 0x0d; p += 32) {
    campos.push({
      nombre: buf.toString("latin1", p, p + 11).replace(/\0.*$/, "").trim(),
      largo: buf[p + 16]
    });
  }

  const filas = [];
  for (let i = 0; i < numRegistros; i++) {
    const ini = largoCabecera + i * largoRegistro;
    if (ini + largoRegistro > buf.length) break;
    const borrado = buf[ini] === 0x2a;
    let o = ini + 1;
    const fila = {};
    for (const c of campos) {
      fila[c.nombre] = buf.toString("latin1", o, o + c.largo).trim();
      o += c.largo;
    }
    filas.push(borrado ? null : fila);
  }
  return filas;
}

// Los nombres traen la hora de emisión (gtwo_areas_202609121725.shp), así que se
// buscan por prefijo.
function leerCapa(carpeta, prefijo) {
  const shp = fs.readdirSync(carpeta).find((n) => n.startsWith(prefijo) && n.endsWith(".shp"));
  if (!shp) return [];
  const base = path.join(carpeta, shp.slice(0, -4));
  if (!fs.existsSync(base + ".dbf")) return [];
  const formas = leerShp(fs.readFileSync(base + ".shp"));
  const filas = leerDbf(fs.readFileSync(base + ".dbf"));
  return formas
    .map((forma, i) => (forma && filas[i] ? { ...filas[i], forma } : null))
    .filter(Boolean);
}

// ------------------------------------------------------------------- textos
// Los .rtf del ZIP son texto plano pese a la extensión: traen el boletín completo.
// De ahí sale el encabezado de cada área ("1. Bay of Campeche:") y su párrafo.
function leerBoletin(archivo) {
  if (!archivo || !fs.existsSync(archivo)) return null;
  const texto = fs.readFileSync(archivo, "latin1").replace(/\r/g, "");
  const secciones = {};
  const re = /^(\d+)\.\s*(.+?):\s*$/gm;
  const marcas = [];
  let m;
  while ((m = re.exec(texto))) {
    marcas.push({ num: m[1], titulo: m[2].trim(), desde: m.index + m[0].length });
  }
  marcas.forEach((marca, i) => {
    const hasta = i + 1 < marcas.length ? marcas[i + 1].desde - marcas[i + 1].titulo.length : texto.length;
    const cuerpo = texto
      .slice(marca.desde, Math.max(hasta, marca.desde))
      .split(/^\s*\*/m)[0] // corta antes de las viñetas de probabilidad
      .replace(/\s+/g, " ")
      .trim();
    secciones[marca.num] = { titulo: marca.titulo, descripcion: cuerpo };
  });
  return secciones;
}

// ---------------------------------------------------------------- títulos
// Los títulos del NHC siguen una gramática corta y fija:
//   [Well|Far] <direcciones> [of [the]] <lugar> [(CÓDIGO)]
// Ejemplos reales: "Bay of Campeche" · "Southwestern Gulf of America" ·
// "Central and Western East Pacific (EP97)" · "Well Southeast of the Hawaiian Islands".
//
// Traducir palabra por palabra produce español roto ("Centro del y oeste del East
// Pacífico"), así que se traduce el LUGAR como frase completa y las direcciones se
// mandan a un paréntesis al final, que en español evita el problema de concordancia.
// Si el lugar no está en la tabla, se deja en inglés: es un nombre propio, y dejarlo
// tal cual es preferible a inventar una traducción.
// Cada entrada: [patrón, nombre en español, artículo]. El artículo solo se usa
// cuando el título lleva prefijo ("cerca de" + "el mar Caribe" = "cerca del mar
// Caribe"); sin prefijo, el nombre va solo.
const LUGARES = [
  [/^(the\s+)?Gulf of (America|Mexico)$/i, "Golfo de México", "el"],
  [/^(the\s+)?Bay of Campeche$/i, "Sonda de Campeche", "la"],
  [/^(the\s+)?Gulf of Honduras$/i, "Golfo de Honduras", "el"],
  [/^(the\s+)?Caribbean( Sea)?$/i, "mar Caribe", "el"],
  [/^(the\s+)?(Tropical )?East(ern)? Pacific$/i, "Pacífico oriental", "el"],
  [/^(the\s+)?(Tropical )?Central Pacific$/i, "Pacífico central", "el"],
  [/^(the\s+)?(Tropical )?Pacific$/i, "Pacífico", "el"],
  [/^(the\s+)?Tropical Atlantic$/i, "Atlántico tropical", "el"],
  [/^(the\s+)?Subtropical Atlantic$/i, "Atlántico subtropical", "el"],
  [/^(the\s+)?Atlantic$/i, "Atlántico", "el"],
  [/^(the\s+)?Hawaiian Islands$/i, "islas de Hawái", "las"],
  [/^(the\s+)?Windward Islands$/i, "islas de Barlovento", "las"],
  [/^(the\s+)?Leeward Islands$/i, "islas de Sotavento", "las"],
  [/^(the\s+)?Cabo Verde Islands$/i, "islas de Cabo Verde", "las"],
  [/^(the\s+)?Bahamas$/i, "Bahamas", "las"],
  [/^(the\s+)?Greater Antilles$/i, "Antillas Mayores", "las"],
  [/^(the\s+)?Lesser Antilles$/i, "Antillas Menores", "las"],
  [/^(the\s+)?Yucatan Peninsula$/i, "península de Yucatán", "la"],
  [/^(the\s+)?Baja California Peninsula$/i, "península de Baja California", "la"],
  [/^(the\s+)?Central America$/i, "Centroamérica", ""],
  [/^(the\s+)?Mexico$/i, "México", ""],
  [/^(the\s+)?Florida$/i, "Florida", ""],
  [/^(the\s+)?Cuba$/i, "Cuba", ""],
  [/^(the\s+)?Carolinas$/i, "Carolinas", "las"]
];
const DIRECCIONES = {
  north: "norte", northern: "norte", south: "sur", southern: "sur",
  east: "este", eastern: "este", west: "oeste", western: "oeste",
  northeast: "noreste", northeastern: "noreste", northwest: "noroeste",
  northwestern: "noroeste", southeast: "sureste", southeastern: "sureste",
  southwest: "suroeste", southwestern: "suroeste", central: "centro"
};

function traducirLugar(lugar) {
  const t = lugar.trim();
  for (const [re, es, art] of LUGARES) if (re.test(t)) return { nombre: es, art };
  // Nombre propio que no está en la tabla: se deja en inglés antes que inventarlo.
  return { nombre: t.replace(/^the\s+/i, ""), art: "" };
}
// Contracciones: de+el=del, a+el=al.
function deLugar(l) {
  if (l.art === "el") return "del " + l.nombre;
  return (l.art ? "de " + l.art + " " : "de ") + l.nombre;
}
function aLugar(l) {
  if (l.art === "el") return "al " + l.nombre;
  return (l.art ? "a " + l.art + " " : "a ") + l.nombre;
}

function traducirTitulo(bruto) {
  let t = String(bruto).trim();

  // 1. El código del invest ("(EP97)") se guarda aparte y se repone al final.
  let codigo = "";
  const mCodigo = t.match(/\s*\(([^)]+)\)\s*$/);
  if (mCodigo) {
    codigo = mCodigo[1];
    t = t.slice(0, mCodigo.index).trim();
  }

  // 2. Prefijos que cambian la relación con el lugar, no la dirección.
  let prefijo = ""; // "frente" rige "a", los demás rigen "de"
  let intenso = false;
  let m;
  if ((m = t.match(/^(Offshore|Off)\s+of\s+/i))) { prefijo = "frente"; t = t.slice(m[0].length); }
  else if ((m = t.match(/^Coastal Waters\s+of\s+/i))) { prefijo = "aguas costeras"; t = t.slice(m[0].length); }
  else if ((m = t.match(/^Near\s+/i))) { prefijo = "cerca"; t = t.slice(m[0].length); }
  if ((m = t.match(/^(Well|Far)\s+/i))) { intenso = true; t = t.slice(m[0].length); }

  // 3. Direcciones encadenadas al inicio ("Central and Western", "Southeastern").
  const dirs = [];
  const rePrimera = new RegExp("^(" + Object.keys(DIRECCIONES).join("|") + ")\\b\\s*", "i");
  while ((m = t.match(rePrimera))) {
    dirs.push(DIRECCIONES[m[1].toLowerCase()]);
    t = t.slice(m[0].length);
    const conector = t.match(/^(and|,)\s*/i);
    if (conector && rePrimera.test(t.slice(conector[0].length))) t = t.slice(conector[0].length);
    else break;
  }

  // 4. "of the" separa una dirección RELATIVA al lugar ("al sureste de X") de un
  //    adjetivo que es parte del lugar mismo ("Atlántico tropical (centro)").
  let relativo = false;
  if ((m = t.match(/^of\s+(the\s+)?/i))) { relativo = true; t = t.slice(m[0].length); }

  if (!t.trim()) return bruto; // no quedó nada reconocible: se devuelve el original
  const lugar = traducirLugar(t);
  const rumbos = dirs.join(" y ");

  let salida;
  if (prefijo === "frente") {
    // "Frente al sur de México" / "Frente al mar Caribe"
    salida = dirs.length ? "frente al " + rumbos + " " + deLugar(lugar) : "frente " + aLugar(lugar);
  } else if (prefijo) {
    // "Cerca del noroeste del mar Caribe" / "Aguas costeras de las Carolinas"
    salida = dirs.length ? prefijo + " del " + rumbos + " " + deLugar(lugar) : prefijo + " " + deLugar(lugar);
  } else if (dirs.length && relativo) {
    // La dirección es relativa al lugar: "al sureste de las islas de Hawái".
    salida = lugar.nombre + " (" + (intenso ? "muy " : "") + "al " + rumbos + ")";
  } else if (dirs.length) {
    // La dirección es parte del lugar: "Atlántico tropical (centro)".
    salida = lugar.nombre + " (" + (intenso ? "extremo " : "") + rumbos + ")";
  } else {
    salida = lugar.nombre;
  }
  if (codigo) salida += " · " + codigo;
  return salida.charAt(0).toUpperCase() + salida.slice(1);
}

const RIESGOS = { low: "bajo", medium: "medio", high: "alto" };
function normalizarRiesgo(r) {
  const t = String(r || "").trim().toLowerCase();
  return RIESGOS[t] || t || null;
}
function porcentaje(p) {
  const n = parseInt(String(p).replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

// ------------------------------------------------------------ simplificar
// El NHC dibuja las áreas con 300 vértices, que a escala de continente no se
// distinguen de 40. Ramer-Douglas-Peucker con tolerancia en grados (~0.05° = 5 km):
// conserva las esquinas de los polígonos irregulares y aplana las elipses suaves.
function distanciaARecta(p, a, b) {
  const [py, px] = p;
  const [ay, ax] = a;
  const [by, bx] = b;
  const dy = by - ay;
  const dx = bx - ax;
  const largo2 = dy * dy + dx * dx;
  if (largo2 === 0) return Math.hypot(py - ay, px - ax);
  let t = ((py - ay) * dy + (px - ax) * dx) / largo2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(py - (ay + t * dy), px - (ax + t * dx));
}
function simplificar(puntos, tol) {
  if (puntos.length <= 3) return puntos;
  let peor = 0;
  let idx = 0;
  for (let i = 1; i < puntos.length - 1; i++) {
    const d = distanciaARecta(puntos[i], puntos[0], puntos[puntos.length - 1]);
    if (d > peor) { peor = d; idx = i; }
  }
  if (peor <= tol) return [puntos[0], puntos[puntos.length - 1]];
  return simplificar(puntos.slice(0, idx + 1), tol)
    .slice(0, -1)
    .concat(simplificar(puntos.slice(idx), tol));
}
function simplificarAnillo(anillo, tol) {
  // Un anillo cerrado no se puede partir por sus extremos (coinciden), así que se
  // corta en dos mitades opuestas y se simplifica cada una.
  if (anillo.length <= 6) return anillo;
  const medio = Math.floor(anillo.length / 2);
  const a = simplificar(anillo.slice(0, medio + 1), tol);
  const b = simplificar(anillo.slice(medio), tol);
  const unido = a.slice(0, -1).concat(b);
  return unido.length >= 4 ? unido : anillo;
}

// Centro del área: promedio del anillo exterior. Es el respaldo para la distancia a
// Campeche cuando el shapefile de puntos no trae el marcador del área.
function centroide(anillos) {
  const a = anillos && anillos[0];
  if (!a || !a.length) return null;
  let lat = 0;
  let lon = 0;
  for (const par of a) {
    lat += par[0];
    lon += par[1];
  }
  return [+(lat / a.length).toFixed(3), +(lon / a.length).toFixed(3)];
}

// ---------------------------------------------------------------------- main
const carpeta = process.argv[2];
const salida = process.argv[3];
if (!carpeta || !salida) {
  console.error("Uso: node vigilancia.mjs <carpeta> <salida.json>");
  process.exit(2);
}

const areas = leerCapa(carpeta, "gtwo_areas");
const puntos = leerCapa(carpeta, "gtwo_points");

const archivos = fs.readdirSync(carpeta);
const rutaSi = (nombre) => (nombre ? path.join(carpeta, nombre) : null);
const textos = {
  Atlantic: leerBoletin(rutaSi(archivos.find((n) => n.startsWith("two_atl_text")))),
  Pacific: leerBoletin(rutaSi(archivos.find((n) => n.startsWith("two_pac_text"))))
};

// El boletín oficial de cada cuenca: es a las zonas lo que el cono es a los
// ciclones, la fuente que manda cuando la tarjeta se queda corta.
const BOLETINES = {
  Atlantic: "https://www.nhc.noaa.gov/gtwo.php?basin=atlc&fdays=7",
  Pacific: "https://www.nhc.noaa.gov/gtwo.php?basin=epac&fdays=7"
};
const CUENCAS_ES = { Atlantic: "Atlántico", Pacific: "Pacífico oriental" };

const zonas = areas.map((a) => {
  const cuenca = String(a.BASIN || "").trim();
  const numero = String(a.AREA || "").trim();
  const seccion = (textos[cuenca] || {})[numero] || {};
  const punto = puntos.find(
    (p) => String(p.BASIN || "").trim() === cuenca && String(p.AREA || "").trim() === numero
  );
  const anillos = (a.forma.anillos || []).map((anillo) => simplificarAnillo(anillo, 0.05));
  const centro =
    punto && punto.forma.tipo === "punto"
      ? [+punto.forma.lat.toFixed(3), +punto.forma.lon.toFixed(3)]
      : centroide(anillos);

  return {
    cuenca,
    cuencaEs: CUENCAS_ES[cuenca] || cuenca,
    numero,
    titulo: seccion.titulo ? traducirTitulo(seccion.titulo) : "Área " + numero,
    tituloOriginal: seccion.titulo || null,
    // El párrafo del NHC va tal cual, en inglés: traducirlo automáticamente sin
    // revisión sería poner palabras propias en boca de un boletín oficial.
    descripcion: seccion.descripcion || null,
    boletin: BOLETINES[cuenca] || null,
    prob2dias: porcentaje(a.PROB2DAY),
    riesgo2dias: normalizarRiesgo(a.RISK2DAY),
    prob7dias: porcentaje(a.PROB7DAY),
    riesgo7dias: normalizarRiesgo(a.RISK7DAY),
    centro,
    anillos
  };
});

// Lo más probable primero: es lo que interesa ver arriba en el tablero.
zonas.sort((a, b) => (b.prob7dias ?? -1) - (a.prob7dias ?? -1));

// Una cuenca con boletín pero sin áreas es "no se espera formación en 7 días": es
// información, no ausencia de datos, y la página lo dice tal cual.
const sinFormacion = Object.entries(textos)
  .filter(([, sec]) => sec && Object.keys(sec).length === 0)
  .map(([cuenca]) => CUENCAS_ES[cuenca] || cuenca);

const resultado = {
  generado: new Date().toISOString(),
  fuente: "https://www.nhc.noaa.gov/xgtwo/gtwo_shapefiles.zip",
  total: zonas.length,
  cuencasSinFormacion: sinFormacion,
  zonas
};

fs.mkdirSync(path.dirname(salida), { recursive: true });
fs.writeFileSync(salida, JSON.stringify(resultado, null, 2) + "\n");

console.log("Zonas en vigilancia:", zonas.length);
for (const z of zonas) {
  console.log(
    `  [${z.cuenca} ${z.numero}] ${z.titulo} - 2d ${z.prob2dias}% (${z.riesgo2dias}) - ` +
      `7d ${z.prob7dias}% (${z.riesgo7dias}) - ${z.anillos.length} anillo(s)`
  );
}
if (sinFormacion.length) console.log("Sin formación esperada en:", sinFormacion.join(", "));
