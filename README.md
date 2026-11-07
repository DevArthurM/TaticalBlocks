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
