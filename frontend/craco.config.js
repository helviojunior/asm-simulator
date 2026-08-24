const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Cache-busting build stamp
//
// Um timestamp por build/compilacao, exposto ao app via REACT_APP_BUILD_TS
// (em JS: process.env.REACT_APP_BUILD_TS; no HTML: %REACT_APP_BUILD_TS%).
// Todo objeto estatico recebe o sufixo `?ts=<TS>`, de modo que cada novo build
// invalida o cache do browser/CDN — inclusive os assets externos hospedados no
// media.sec4us.com.br.
//
// Definido aqui (no load do config) para que o valor seja fixado uma unica vez
// antes do react-scripts ler o ambiente, e seja identico em `start` e `build`.
// Um pipeline de CI pode sobrescrever exportando REACT_APP_BUILD_TS.
// ---------------------------------------------------------------------------
process.env.REACT_APP_BUILD_TS =
  process.env.REACT_APP_BUILD_TS || String(Math.floor(Date.now() / 1000));

const BUILD_TS = process.env.REACT_APP_BUILD_TS;

// O CRA so interpola variaveis de ambiente no index.html — os demais arquivos
// de public/ sao copiados verbatim. Este plugin reescreve %REACT_APP_BUILD_TS%
// nos estaticos emitidos (manifest.json e afins) para que as URLs deles tambem
// saiam carimbadas.
const INTERPOLATED_FILES = ["manifest.json", "asset-manifest.json"];

class InterpolateStaticPlugin {
  apply(compiler) {
    compiler.hooks.afterEmit.tap("InterpolateStaticPlugin", () => {
      const outDir = compiler.options.output.path || "";
      for (const file of INTERPOLATED_FILES) {
        const outFile = path.join(outDir, file);
        try {
          const src = fs.readFileSync(outFile, "utf8");
          if (src.includes("%REACT_APP_BUILD_TS%")) {
            fs.writeFileSync(outFile, src.split("%REACT_APP_BUILD_TS%").join(BUILD_TS));
          }
        } catch (e) {
          // Arquivo inexistente (ou dev server servindo public/ da memoria) — ignora.
        }
      }
    });
  }
}

module.exports = {
  style: {
    postcss: {
      mode: 'extends',
      loaderOptions: (postcssLoaderOptions) => {
        return postcssLoaderOptions;
      },
    },
  },
  webpack: {
    plugins: {
      add: [new InterpolateStaticPlugin()],
    },
  },
};
