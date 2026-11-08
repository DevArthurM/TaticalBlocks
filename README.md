# FPS — Campo de Testes

FPS em primeira pessoa com Three.js (Vite + TypeScript) e servidor NestJS.

## Rodar

```bash
npm install
npm run dev        # sobe server (:3000) e client (:5173) juntos
```

Abra http://localhost:5173 e clique na tela. Se o servidor estiver fora do ar, o cliente usa um mapa local.

| Tecla | Ação |
|---|---|
| WASD | mover |
| Shift | correr |
| Espaço | pular |
| Mouse esq. | atirar |
| Mouse dir. | mirar |
| R | recarregar |
| 1 2 3 4 | principal / secundária / branca / granada |
| Roda do mouse / X | próxima arma / última arma |
| Q / E | inclinar a cabeça para a esquerda / direita |
| V | inspecionar a arma (mostra a munição) |
| C | agachar / levantar (alterna) |
| Espaço (segurar no ar) | agarrar a quina à frente · **W** escala · soltar Espaço ou **S** cai |
| B / Esc | abrir / fechar o Arsenal (menu radial) |

## Arsenal

31 armas em 8 categorias, cada uma com tier (Comum → Lendária), modelo voxel próprio e
animação de recarga personalizada. Loadout: 1 principal, 1 secundária, 1 arma branca e até
5 granadas de um único tipo — validado no cliente e no servidor (`shared/weapons/loadout.ts`).

| Categoria | Armas |
|---|---|
| Pistolas | G17, G17 Inox, G34 Competição, G19 FDE, Revólver .357 |
| Submetralhadoras | MP7, MP5K, TMP, MAC-10, UMP-45, P90 |
| Fuzis | M4A1, AK-47, M16A4 (rajada), HK416 |
| Escopetas | Escopeta 870, M590 Shorty, AA-12 |
| Precisão | Rifle de Caça, AWM, SR-25 DMR |
| Pesadas | M249, Minigun M134, RPG-7, M32 MGL |
| Brancas | Faca de Combate, Machadinha, Marreta |
| Arremessáveis | Fragmentação, Atordoamento, Molotov |

## Mapa "Pátio Voxel"

Mapa padrão (`shared/map/voxelYard.ts`, usado pelo servidor e pelo modo offline), todo em voxel e destrutível, com borda indestrutível. Arena **PvP 1v1** com simetria de ponto (girada 180° em torno do centro: as duas bases têm exatamente as mesmas rotas e coberturas):

- **Bases** azul (sul, spawn) e vermelha (norte): sala em U com saída central e portas laterais, faixa e pilares na cor do time, muretas logo na saída.
- **Meio**: bunker de concreto com teto, janelas alinhadas à rota central e portas laterais; muretas, caixotes e pilares de aproximação.
- **Rotas laterais**: barracão de madeira atravessável de um lado, corredor de contêineres (um oco aberto, um fechado para subir pela quina) do outro; divisórias com janela baixa ligando as rotas.
- **Caixas com física** em posições espelhadas (`MapData.crates`). O gerador aleatório antigo continua em `GET /api/map?mode=classic`.

### Materiais

| Material | Vida/voxel | Comportamento |
|---|---|---|
| Plástico | 1 | estilhaça fácil, pedaços coloridos e leves; vão máx. 1,5 m |
| Madeira | 2 | tábuas visíveis, lascas; vão máx. 3,5 m |
| Concreto | 4 | resistente, poeira; vão máx. 5 m |
| Metal | 10 | amassa/escurece antes de furar, faíscas, chapa ondulada; vão máx. 6 m |

Dano do tiro ≈ dano da arma ÷ 10 por voxel, caindo com a distância ao ponto de impacto. Blocos se apoiam no chão ou em voxels de outros blocos (embaixo ou ao lado); o que perde apoio ou passa do vão máximo do material desaba em cascata. Ajustes em `client/src/world/destruction/materials.ts`.

## Destruição e física

- **Blocos destrutíveis**: cada caixa do mapa vira uma grade de voxels (~25 cm) no primeiro dano. Tiros abrem crateras irregulares (raio cresce com o dano da arma), golpes cavam, explosões arrancam pedaços grandes. O que perde apoio desaba. Voxels removidos viram detritos com física + poeira; o miolo exposto é mais escuro (profundidade). Colisão, escalada e raycast seguem os voxels que restam. Paredes externas são indestrutíveis.
- **Caixas de madeira** (`cannon-es`): pilhas e caixas soltas que caem, tombam, recebem impulso no ponto do tiro, são arremessadas por explosões, podem ser empurradas andando e servem de plataforma.

Código: `client/src/world/destruction/` (`VoxelBlock`, `DestructionSystem`), `client/src/world/Crates.ts`, `client/src/physics/`.

## HUD

Durante o jogo só a mira aparece. A munição é vista inspecionando a arma (**V**): a arma gira na mão e um número flutua ao lado dela com o cartucho daquela arma girando (GIFs `ammo_*.gif`, gerados em `/tools/gifs.html` → *Renderizar cartuchos*). Granadas mostram quantas restam. Mirando e andando de lado, um ponto aparece no centro da tela, mais visível quanto mais o braço inclina.

**Foco ao mirar:** um túnel de foco (vinheta) escurece as bordas e fecha conforme o jogador fica parado mirando (~2,5 s até o máximo; andar abre). A arma é composta com desfoque leve, exceto um pequeno círculo nítido no centro: a massa de mira fica nítida e a alça de mira/corpo da arma levemente desfocados (`client/src/core/ViewmodelFocus.ts`). Fora da mira não há custo extra.

## Mapa Hospital (barricadas)

Abra com `?mapa=hospital` ou pelos botões **Mapa** na tela de pausa. Corredor escuro de 40 m com azulejos, piso quadriculado, macas, posto de enfermagem, fluorescentes no teto (algumas piscando) e luar entrando pelas janelas.

- 6 janelas e 2 saídas de emergência, cada uma com **5 tábuas**.
- Os zumbis nascem do lado de fora, vão até a abertura menos disputada e arrancam uma tábua por golpe (~1,3 s). Sem tábuas, **pulam a janela** ou **entram pela porta**, e aí perseguem o jogador.
- **Segure F** perto de uma abertura danificada para pregar tábuas de volta (~0,55 s cada). Com qualquer tábua no lugar, a abertura bloqueia a passagem.
- Paredes e teto do hospital são indestrutíveis; a mobília continua destrutível.

Código: `shared/map/hospital.ts`, `client/src/world/{Barricades,Environment}.ts`.

## Desempenho

- **Zumbis instanciados** (`client/src/enemies/zombie/ZombieInstancer.ts`): as malhas de cada zumbi continuam existindo (ossos, raycast dos tiros, desmembramento, ragdoll), mas ficam invisíveis; um `InstancedMesh` por material desenha todos de uma vez. Com 32 zumbis: ~727 → ~272 draw calls.
- **Resolução dinâmica** (Configurações → Gráficos): abaixo de ~50 FPS reduz a resolução em passos de 10% (até 60% da escolhida) e volta a subir aos poucos quando sobra folga. Se subir logo causar nova queda, aquele nível vira teto por 30 s.
- **Luzes por proximidade** (hospital): só as 4 luminárias mais próximas têm `PointLight` de verdade (número fixo, sem recompilar shaders); as outras só brilham.
- **Matrizes estáticas**: cenário, voxels, marcas de tiro e tábuas usam `matrixAutoUpdate = false`; as matrizes do mundo são atualizadas uma vez por quadro em `RendererSystem.render`.
- **Shaders pré-compilados** (`compileAsync`) na abertura ("Preparando gráficos…", até 6 s), para o primeiro tiro/zumbi/explosão não travar. A luz do clarão do tiro fica sempre na cena (intensidade 0), porque mudar o número de luzes troca os shaders.

## Zumbis

Ondas de **1, 2, 4, 8, 16 e 32** zumbis (depois sempre 32), surgindo pelas bordas.

**Variações procedurais** (`client/src/enemies/zombie/variants.ts`): 5 partes de cima (camiseta, camisa xadrez de manga comprida, regata, jaqueta de couro com gola, avental hospitalar) × 5 de baixo (jeans, cáqui, social preta, bermuda com canela à mostra, moletom) × 5 calçados (sapato, tênis branco, bota com cano, tênis vermelho, descalço) = **125 combinações de roupa**, sobre **5 tons de pele** (cada um com a cor de cabelo própria) — 625 visuais. O diretor sorteia de um "baralho" embaralhado: uma roupa só se repete depois das 125. As roupas são texturas neutras tingidas por instância, então todas as variações usam só 16 materiais (~16 draw calls para todos os zumbis).

| Zona | Multiplicador | Parte arrancável (vida própria) |
|---|---|---|
| Cabeça | ×3,5 | cabeça (40) — decapitação mata |
| Pescoço | ×2,2 | cabeça |
| Tronco / Cintura / Quadril | ×1 / ×0,9 / ×0,85 | — |
| Ombro | ×0,55 | braço inteiro (38) |
| Antebraço | ×0,45 | antebraço + mão (24) |
| Mão | ×0,35 | mão (12) |
| Coxa | ×0,65 | perna inteira (48) |
| Joelho / Perna | ×0,55 / ×0,5 | canela + pé (30) |
| Pé | ×0,35 | pé (14) |

Vida 100. Animação procedural muda com o que foi perdido: anda arrastado com braços estendidos; sem um braço o toco balança e o corpo pende; sem os dois cambaleia mais rápido; sem pé manca; sem perna cai e rasteja puxando com os braços. Partes arrancadas voam com física e sangram. Na morte vira **ragdoll** (cannon-es) com impulso no ponto do tiro; explosões arremessam. Zumbis atacam (golpe/mordida); o jogador tem 100 de vida com regeneração, bordas vermelhas ao levar dano e renasce (ondas recomeçam) ao morrer.

Código: `client/src/enemies/` (`ZombieDirector`, `zombie/Zombie`, `ZombieModel`, `Ragdoll`, `zones`).

## Configurações

Na tela de pausa (Esc) → **⚙ Configurações**. Salvas no navegador (`localStorage`).

- **Gráficos**: predefinição (Baixo / Médio / Alto / Ultra), resolução (50–100%) e sombras (desligadas / baixa / média / alta).
- **Câmera**: campo de visão (60–110 no controle; acima de 75 é comprimido e o 110 equivale a 93,5° reais). O zoom das miras de ferro/red-dot acompanha; lunetas mantêm o zoom fixo.
- **Controles**: sensibilidade, sensibilidade mirando, mira **segurar** ou **clicar para alternar**, inclinar (Q/E) **segurar**, **clicar para alternar** ou **desativado**.

Código em `client/src/settings/Settings.ts` e `client/src/ui/settings/`.

## Menu Arsenal (B)

Menu radial sobre o jogo desfocado (vidro turvo), montado peça a peça a partir do centro:

- **Anel**: Primária (esquerda), Secundária (direita) e Arma branca (embaixo); o centro mostra detalhes do item sob o mouse.
- **Arcos**: passar o mouse num compartimento abre, sempre na mesma posição lateral, o arco de **categorias** daquele slot; cada categoria abre um segundo arco com as **armas** (slots com uma única categoria já abrem as armas direto). Âncoras em `BAND_ANCHOR`.
- **Arremessáveis**: círculo abaixo do anel + até 5 quadrados (um por granada, com “−” para remover). Passando o mouse no círculo aparecem os tipos: clicar no mesmo tipo dá +1, clicar em outro troca para 1 do novo tipo.

Código em `client/src/ui/arsenal/` (`ArsenalWheel.ts`, `geometry.ts`, `arsenal.css`).

## GIFs do menu

As miniaturas giratórias do Arsenal são GIFs pré-renderizados (160×90, 25 fps, 50 quadros,
48 cores, fundo transparente, ~34 KB cada) em `client/public/weapons/gifs/`.
Para regerar após mudar um modelo: rode `npm run dev`, abra
http://localhost:5173/tools/gifs.html e clique em **Renderizar todas** — a página
renderiza cada arma com three.js, codifica com `gifenc` e o Vite grava os arquivos.
Configuração em `client/tools/gif-renderer.ts` (`GIF`).

## Estrutura

```
shared/weapons/   catálogo, categorias, tiers e regras de loadout (usado por cliente e servidor)

server/src/
  map/        GET /api/map?seed=
  weapons/    GET /api/weapons[?category=] · /api/weapons/categories · /api/weapons/:id
  loadout/    GET/PUT/DELETE /api/loadout · POST /api/loadout/validate
  health/     GET /api/health

client/src/
  core/       Game (loop), RendererSystem (mundo + viewmodel), Input, Spring, math
  net/        ApiClient com fallback local
  world/      World, chão, caixas brancas, iluminação com sombras
  player/     PlayerController (movimento/pulo/corrida), colisão AABB
  weapons/
    WeaponManager.ts   entrada → inventário → disparo/golpe/arremesso → viewmodel
    logic/      Firearm (pente, cartucho-a-cartucho, rajada, pump, ferrolho, giro), Inventory
    models/     ModelBuilder (DSL voxel) + um arquivo por categoria + registry
    animation/  Clip (keyframes), reloads.ts (recarga de cada arma), actions.ts (ciclos, golpes, arremesso)
    view/       Viewmodel genérico, braços, clarão, cápsulas
    combat/     Projectiles (foguete, 40 mm, granadas com quique), Explosions (frag, luz, fogo)
  effects/    partículas instanciadas e decalques
  audio/      sons sintetizados com WebAudio
  ui/         HUD (slots, munição, luneta, clarão), arsenal/ (menu radial B)
  textures/   texturas procedurais (camuflado, pele, luva, parede, chão)
```
