import { withTs } from "lib/asset";
import logoLight from "assets/brand/sec4us-light-mode.png";
import logoDark from "assets/brand/sec4us-dark-mode.png";

/**
 * Identidade visual do sistema, configuravel por ambiente.
 *
 * Os PADRÕES são LOCAIS: o ambiente roda offline na máquina do aluno, e um
 * logo remoto simplesmente não carregaria. Quem tiver rede pode apontar
 * REACT_APP_BRAND_LOGO/-_DARK/-_FAVICON para URLs externas.
 *
 * Cache-busting: os arquivos empacotados ganham hash de conteúdo no nome;
 * o `withTs` fica reservado às URLs externas vindas do ambiente.
 */
export const MEDIA_BASE = process.env.REACT_APP_MEDIA_BASE || "";

// Arte oficial embarcada. Importada (e nao referenciada por caminho) para o
// webpack emiti-la com hash de conteudo no nome — o que ja resolve o
// cache-busting sem precisar do ?ts=.
//
// O sufixo indica o MODO em que a arte e usada, nao a cor dela: a dark-mode e
// branca, para aplicar sobre fundo escuro.
const LOCAL_FAVICON = "/favicon.png";

/**
 * URL final de um asset de marca.
 *
 * Valor vindo do ambiente e uma URL externa e precisa do carimbo do build; o
 * arquivo empacotado ja vem com hash no nome e dispensa o ?ts=.
 */
function resolveAsset(override, bundled) {
  return override ? withTs(override) : bundled;
}

const brand = {
  name: process.env.REACT_APP_BRAND_NAME || "ASMSimulator",
  // logo = tema claro; logoDark = tema escuro. O sufixo do arquivo indica o
  // MODO em que a arte e usada, nao a cor dela.
  logo: resolveAsset(process.env.REACT_APP_BRAND_LOGO, logoLight),
  logoDark: resolveAsset(process.env.REACT_APP_BRAND_LOGO_DARK, logoDark),
  favicon: withTs(process.env.REACT_APP_BRAND_FAVICON || LOCAL_FAVICON),
  contactEmail:
    process.env.REACT_APP_BRAND_CONTACT_EMAIL || "contato@asmsimulator.com.br",
  version: process.env.REACT_APP_VERSION || "1.0.0",
};

export default brand;
