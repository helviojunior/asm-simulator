# Marca

Arte oficial da SEC4US, **embarcada** porque o simulador roda offline na
máquina do aluno — referenciar `media.sec4us.com.br` deixaria a interface sem
marca sempre que não houvesse rede.

| Arquivo | Usado em | Origem |
|---|---|---|
| `sec4us-light-mode.png` | fundos **claros** | `media.sec4us.com.br/logo/sec4us-light-mode.png` |
| `sec4us-dark-mode.png` | fundos **escuros** (é o caso do simulador) | `media.sec4us.com.br/logo/sec4us-dark-mode.png` |

> O sufixo indica o **modo em que a arte é usada**, não a cor dela: a
> `dark-mode` é branca com o símbolo vermelho, para aplicar sobre fundo escuro.

O favicon (`public/favicon.png` e `favicon.ico`) vem de
`media.sec4us.com.br/icon/`.

## Atualizar

```bash
curl -sSLO https://media.sec4us.com.br/logo/sec4us-light-mode.png
curl -sSLO https://media.sec4us.com.br/logo/sec4us-dark-mode.png
```

Estes arquivos ficam em `src/` (não em `public/`) para o webpack empacotá-los
com hash de conteúdo no nome — cache-busting sem depender do `?ts=`.
