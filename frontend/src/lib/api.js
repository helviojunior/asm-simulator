import axios from "axios";

/**
 * Cliente HTTP da aplicacao.
 *
 * O projeto e 100% publico: a API nao tem autenticacao, entao nao existe
 * token para guardar nem interceptor de 401 para redirecionar ao login.
 */
/*
 * Sem `Content-Type` fixo: o axios deduz por requisicao — `application/json`
 * para objeto comum e `multipart/form-data` COM o boundary para FormData.
 * Fixado em json, o upload do `.scasmlib` saia sem boundary e chegava ao
 * Django como um corpo vazio: `request.FILES` ficava sem o arquivo e a API
 * respondia "escolha um arquivo para importar".
 */
const api = axios.create();

export default api;
