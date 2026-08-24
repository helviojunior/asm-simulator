// Cache-busting de TODO objeto estatico (logo, favicon, imagens, sons, PDFs…):
// acrescenta `?ts=<build timestamp>` para que um novo build invalide o cache do
// browser/CDN — inclusive de URLs externas (media.sec4us.com.br).
//
// REACT_APP_BUILD_TS e fixado no craco.config.js (um valor por build, igual em
// `start` e `build`) e pode ser sobrescrito pelo Docker/CI.
export const BUILD_TS = process.env.REACT_APP_BUILD_TS || "dev";

/**
 * Carimba a URL com o timestamp do build.
 * Valores vazios e data: URIs passam intactos (data URI nao aceita query).
 */
export function withTs(url) {
  if (!url || typeof url !== "string" || url.startsWith("data:")) return url;
  return url + (url.includes("?") ? "&" : "?") + "ts=" + BUILD_TS;
}

/**
 * Resolve um caminho de public/ (ex.: "/assets/logo.png") ja carimbado.
 * URLs absolutas passam direto pelo withTs.
 */
export function asset(pathOrUrl) {
  if (!pathOrUrl) return pathOrUrl;
  if (/^https?:\/\//i.test(pathOrUrl) || pathOrUrl.startsWith("data:")) {
    return withTs(pathOrUrl);
  }
  const base = process.env.PUBLIC_URL || "";
  const normalized = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  return withTs(`${base}${normalized}`);
}

// Alias historico (nos outros projetos a query era `?v=`).
export const withV = withTs;
