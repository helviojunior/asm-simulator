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
    U+F179        ícone Apple (nf-fa-apple)
    U+F17A        ícone Windows (nf-fa-windows)
    U+F17C        ícone Linux (nf-fa-linux)

Os ~9000 glifos de ícone da Nerd Font (devicons, seti, font-awesome…) foram
removidos: eles respondiam por 94% do tamanho — 1 MB por variante contra os
~60 KB atuais. Os **três ícones de sistema operacional** são a exceção: a
interface os desenha ao lado do alvo de cada programa, e sem eles o navegador
cairia para outra fonte e mostraria o retângulo de glifo ausente.

**Para incluir outro ícone**, acrescente o ponto de código à lista e regenere
as quatro variantes:

```bash
RANGES="U+0000-00FF,U+0100-017F,U+2000-206F,U+2190-21FF,U+2500-259F,\
U+25A0-25FF,U+2600-26FF,U+E0A0-E0D4,U+FFFD,U+F179,U+F17A,U+F17C"

for v in "Regular" "Bold" "Italic" "Bold Italic"; do
  curl -sSLO "https://github.com/romkatv/powerlevel10k-media/raw/master/MesloLGS%20NF%20${v// /%20}.ttf"
  pyftsubset "MesloLGS NF $v.ttf" --unicodes="$RANGES" --flavor=woff2 \
    --output-file="MesloLGS-NF-${v// /}.woff2"
done
```

Confira depois que o glifo entrou **e** que ele tem a largura de avanço do
`0` (1233): um ícone mais largo desalinharia as colunas monoespaçadas.

## Ordem de carga

O `@font-face` em `src/index.css` declara `local("MesloLGS NF")` **antes** do
`url()`: quem já tem a fonte instalada no sistema (comum entre usuários do
powerlevel10k) usa a instalada, com todos os ícones, e não baixa nada.
