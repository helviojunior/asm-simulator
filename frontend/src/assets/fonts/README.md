# MesloLGS NF

Fonte da interface do simulador, embarcada porque o ambiente roda **offline**.

## Origem

`MesloLGS NF` é a variante Nerd Font de **Meslo LG**, distribuída pelo projeto
[powerlevel10k](https://github.com/romkatv/powerlevel10k#manual-font-installation).
Meslo LG, por sua vez, deriva de Menlo (Apple) / Bitstream Vera / DejaVu.

## Licenças

- **Meslo LG** — Apache License 2.0 (André Berg)
- **Patch Nerd Fonts** — MIT (Ryan L McIntyre)

## Estes arquivos são um SUBSET

Os `.woff2` aqui contêm apenas os intervalos que a interface desenha:

    U+0000-00FF   Latin básico + Latin-1
    U+0100-017F   Latin Extended-A (acentuação PT-BR)
    U+2000-206F   pontuação geral
    U+2190-21FF   setas
    U+2500-259F   box drawing
    U+25A0-25FF   formas geométricas
    U+2600-26FF   símbolos diversos
    U+E0A0-E0D4   Powerline
    U+FFFD        caractere de substituição

Os ~9000 glifos de ícone da Nerd Font (devicons, seti, font-awesome…) foram
removidos: nenhuma tela os usa, e eles respondiam por 94% do tamanho — 1 MB
por variante contra os ~60 KB atuais.

**Se algum dia a UI precisar dos ícones**, regenere sem `--unicodes`:

```bash
curl -sSLO "https://github.com/romkatv/powerlevel10k-media/raw/master/MesloLGS%20NF%20Regular.ttf"
pyftsubset "MesloLGS NF Regular.ttf" --unicodes="*" --flavor=woff2 \
  --output-file=MesloLGS-NF-Regular.woff2
```

## Ordem de carga

O `@font-face` em `src/index.css` declara `local("MesloLGS NF")` **antes** do
`url()`: quem já tem a fonte instalada no sistema (comum entre usuários do
powerlevel10k) usa a instalada, com todos os ícones, e não baixa nada.
