import { withTs } from "lib/asset";

/**
 * Identidade visual do sistema, configuravel por ambiente.
 *
 * Logo e favicon vêm remotamente do media.sec4us.com.br (padrão do ../sec_face),
 * com cache-busting por build (`withTs`). Definida via REACT_APP_BRAND_* — que
 * saem do .env único da raiz e chegam como build args do Docker.
 */
export const MEDIA_BASE = process.env.REACT_APP_MEDIA_BASE || "https://media.sec4us.com.br";

const brand = {
  name: process.env.REACT_APP_BRAND_NAME || "ASMSimulator",
  // logo = tema claro; logoDark = tema escuro. O sufixo do arquivo indica o
  // MODO em que a arte e usada, nao a cor dela.
  logo: withTs(
    process.env.REACT_APP_BRAND_LOGO || `${MEDIA_BASE}/logo/sec4us-light-mode.svg`
  ),
  logoDark: withTs(
    process.env.REACT_APP_BRAND_LOGO_DARK || `${MEDIA_BASE}/logo/sec4us-dark-mode.svg`
  ),
  favicon: withTs(process.env.REACT_APP_BRAND_FAVICON || `${MEDIA_BASE}/icon/favicon.png`),
  contactEmail:
    process.env.REACT_APP_BRAND_CONTACT_EMAIL || "contato@asmsimulator.com.br",
  version: process.env.REACT_APP_VERSION || "1.0.0",
};

export default brand;
