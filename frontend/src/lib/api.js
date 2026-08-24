import axios from "axios";

/**
 * Cliente HTTP da aplicacao.
 *
 * O projeto e 100% publico: a API nao tem autenticacao, entao nao existe
 * token para guardar nem interceptor de 401 para redirecionar ao login.
 */
const api = axios.create({
  headers: {
    "Content-Type": "application/json",
  },
});

export default api;
