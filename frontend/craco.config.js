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

// ---------------------------------------------------------------------------
// Imports absolutos a partir de `src/`
//
// O react-scripts montava isto sozinho, lendo o `baseUrl` do jsconfig.json. O
// `baseUrl` esta DEPRECIADO e para de funcionar no TypeScript 7 (o editor ja
// acusa), entao o jsconfig passou a declarar `paths: {"*": ["./src/*"]}` — sem
// `baseUrl`, os padroes sao resolvidos em relacao ao proprio arquivo. Aquilo
// serve ao EDITOR; a resolucao de modulo do build e do jest vem daqui, porque
// o react-scripts so olhava para o `baseUrl`.
//
// O jsconfig.json nao pode levar comentario explicando isso: o react-scripts o
// le com `require()`, que e JSON estrito e engasga com `//`.
//
// Anexado no FIM das duas listas, como o CRA fazia: assim `node_modules` e
// consultado primeiro, e uma pasta em src/ com nome de pacote nao o encobre.
// ---------------------------------------------------------------------------
const SRC = path.resolve(__dirname, "src");

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
    configure: (config) => {
      config.resolve.modules = [...(config.resolve.modules || []), SRC];
      return config;
    },
  },
  jest: {
    configure: (config) => {
      config.modulePaths = [...(config.modulePaths || []), SRC];
      return config;
    },
  },
};
