# CLAUDE.md

Guia para trabalhar neste repositório. O `README.md` traz a documentação para quem joga (controles, armas, mapas, modos). Este arquivo explica como o código é organizado e as técnicas usadas.

## O projeto

**TaticalBlocks**: FPS voxel em primeira pessoa no navegador. Ele tem:

- **Arsenal:** cerca de 40 armas com modelos voxel procedurais, recarga animada arma a arma, inspeção (V), menu radial de loadout (B) e acessórios (T).
- **Mapa:** Pátio Voxel, arena PvP 1v1 com cobertura destrutível (único mapa).
- **Destruição:** voxels destrutíveis, detritos com física e decalques.
- **Zumbis:** ondas de inimigos com variantes procedurais de roupa e pele, dano por parte do corpo e ragdoll.
- **Movimento:** corrida, agachar, deslize (Shift + C), inclinar (Q/E), escalar quinas e recuo que sobe a câmera.
- **Online:** salas 1v1, 5v5, 10v10, 1 contra todos, Gun Game e Zumbis cooperativo (até 5), com servidor autoritativo em WebSocket.

Toda a interface, os comentários e os textos do jogo estão em **português**. Mantenha esse padrão.

## Stack

| Parte | Ferramentas |
|---|---|
| Monorepo | npm workspaces (`client`, `server`); `shared/` é importado pelos dois |
| Cliente | Vite 8, TypeScript 5.9, Three.js 0.187, cannon-es (ragdolls e detritos), WebAudio (sons sintetizados), `gifenc` (GIFs do menu) |
| Servidor | NestJS 12: REST (`@nestjs/platform-express`) e WebSocket (`@nestjs/websockets` + `@nestjs/platform-ws`/`ws`) |
| Assets | Quase nada externo: modelos, texturas (canvas) e sons são gerados por código |

## Comandos

```bash
npm install
npm run dev          # libera as portas 3000/5173, sobe server (:3000) e client (:5173)
npm run build        # nest build + (tsc --noEmit && vite build)
npm run bot -- <modo> <n> [salaId]   # bots WebSocket para testar o online (1v1|5v5|10v10|ffa|gungame)
docker compose up -d --build        # produção: um contêiner (jogo em /, API em /api, online em /server)
node scripts/gen-logo.mjs           # regera client/public/logo.svg e favicon.svg
```

Checagem de tipos isolada:

- cliente: `cd client && npx tsc --noEmit`
- servidor: `cd server && npx tsc --noEmit`

O projeto não tem suíte de testes. A verificação é feita no navegador (http://localhost:5173; o online entra pela lista de servidores do menu principal, na mesma rota) e com scripts node que se conectam ao WebSocket.

## Estrutura

```
shared/
  weapons/   catálogo (catalog.ts), categorias, loadout, acessórios (attachments.ts): fonte única das stats
  map/       Pátio Voxel como dados (usado pelo servidor e como fallback do cliente)
  net/       protocolo WebSocket (protocol.ts), dano por zona (damage.ts), spawns por time

server/src/
  map/ weapons/ loadout/ health/   REST em /api/*
  game/      gateway WebSocket em /server, RoomsService (sessões, salas, tick 20 Hz), Room (regras), validate.ts

client/src/
  core/      Game (loop e orquestração), RendererSystem, Input, Spring, pós-processos (ViewmodelFocus, WorldBlur)
  player/    PlayerController (movimento, deslize, inclinação), colisão AABB, LedgeClimb, PlayerBody (pés e torso visíveis)
  weapons/   WeaponManager → logic/ (Firearm, Inventory, ArmRecoil) → view/ (Viewmodel, braços, clarão, cápsulas)
             models/ (DSL ModelBuilder, um arquivo por categoria, attachments.ts) · animation/ (Clip, reloads, actions)
             combat/ (projéteis, explosões)
  world/     World, iluminação, caixas, Barricades, destruction/ (VoxelBlock, DestructionSystem)
  enemies/   ZombieDirector (ondas), zombie/ (modelo, variantes, instancer, ragdoll, zonas)
  online/    NetClient, OnlineSession, avatar/ (RemotePlayer, SoldierModel, ThirdPersonWeapon, ArmIK)
  ui/        HUD, arsenal/ (menu B), attachments/ (menu T), online/ (lobby e HUD online), settings/
  effects/ audio/ textures/ net/(ApiClient com fallback local)
scripts/     free-ports.mjs, bot.mjs
```

Aliases: o cliente importa `@shared/...` (alias do Vite e do tsconfig). O servidor compila com `rootDir: ".."` para incluir `shared/`, por isso a saída fica em `dist/server/src/main.js`.

## Técnicas principais

### Renderização e desempenho
- **Atualização manual de matrizes:** `scene.matrixWorldAutoUpdate = false`, e as matrizes são atualizadas em `RendererSystem.render`. Objetos estáticos usam `matrixAutoUpdate = false`. Num objeto congelado não use `lookAt`, porque ele lê uma `matrixWorld` desatualizada; prefira `quaternion.setFromUnitVectors`.
- **Instanciamento:** `InstancedMesh` agrupado por material, com cor por instância (ZombieInstancer, partículas).
- **Pré-compilação de shaders:** `renderer.compileAsync` roda no carregamento, com timeout. Luzes que acendem e apagam (clarão, lanterna `SpotLight`) ficam sempre na cena com intensidade 0, para não recompilar shaders.
- **Resolução dinâmica:** o pixel ratio varia conforme o tempo de quadro.
- **Viewmodel:** a arma em primeira pessoa é desenhada numa passada própria. Há pós-processos em render target: desfoque de foco na mira de ferro e desfoque do mundo no menu T.

### Armas
- **Modelos procedurais:** `ModelBuilder` é uma DSL de caixas e cilindros com `part`, `anchor` e `irons()`. As âncoras (muzzle, eject, grip, support, sight, mag…) ligam modelo, animação, efeitos e IK dos braços. `irons()` marca alça e massa, que são escondidas quando a arma tem mira óptica.
- **Animação por código:** keyframes (`Clip`) e molas (`Spring`). Cada arma define sua recarga em `reloads.ts`: por pente, cartucho a cartucho, ferrolho, revólver bala a bala etc.
- **Mira:** a alça e a massa ficam sempre no centro da tela; o balanço gira os braços em torno do eixo da mira (`SIGHT_AXIS`). O recuo sobe a câmera.
- **Acessórios:** catálogo, compatibilidade e modificadores de stats ficam em `shared/weapons/attachments.ts`; a aplicação no modelo fica em `weapons/models/attachments.ts`. A escolha é salva no `localStorage` (`fps.attachments`) e enviada no estado online como string codificada.

### Mundo e física
- **Destruição determinística:** o dano nos voxels usa ruído derivado de um hash (índice do voxel + ponto de impacto), para que todos os clientes destruam igual sem sincronizar voxels.
- **Física e colisão:** cannon-es cuida só de detritos e ragdolls. A colisão do jogador é AABB própria.

### Personagens
- **Animação e IK:** braços e pernas usam IK analítico de 2 ossos (`ArmIK.solveArmIK`). As poses são procedurais: andar, correr, agachar, deslizar, recarregar, arremessar.
- **Zumbis:** as variantes combinam roupas (125 combinações) e tons de pele. Cada zona do corpo tem um multiplicador de dano.
- **Visibilidade do jogador:** o jogador local vê só pés e torso. O soldado completo, com camuflado verde ou azul conforme o time, aparece apenas para os outros.

### Online
- **Conexão:** WebSocket em `/server`, na mesma porta do cliente (o Vite faz proxy com `ws: true` em dev). As mensagens são JSON `{event, data}`, tipadas em `shared/net/protocol.ts`.
- **Servidor autoritativo:**
  - O cliente envia estado a 20 Hz; o servidor responde com snapshots, e o cliente interpola com atraso de 0,1 s.
  - O servidor valida os disparos (registro de tiros, cadência pelo rpm, pellets, alcance, time, arma do Gun Game) e calcula o dano como dano da arma × multiplicador da zona.
- **Conexões mortas:** o cliente envia heartbeat a cada 3 s e o servidor encerra conexões ociosas após 10 s. O servidor também limita a 120 mensagens/s por sessão.
- **Modos:** definidos em `MODES` (`protocol.ts`). Fogo amigo só existe nos modos com times. O Gun Game usa `GUNGAME_LADDER`: abate de faca rebaixa a vítima, e matar com a faca no último nível vence.
- **Zumbis online:** um jogador (anfitrião, trocado se sair) roda o `ZombieDirector` e envia `zsync` (estado compacto, `ZOMBIE_FIELDS`) e `zev`; os outros espelham (`Zombie.puppetUpdate`) e mandam acertos por `zhit` (índice da malha). Golpes dos zumbis viram `zatk` e o servidor aplica o dano.

## Convenções

- **Stats e regras:** stats de armas, regras de dano e protocolo ficam em `shared/`. Nunca duplique esses valores no cliente ou no servidor.
- **Mudanças no protocolo:** atualize `ClientEvents`/`ServerEvents`, a validação em `server/src/game/validate.ts` e `OnlineSession` juntos.
- **Assets:** prefira geração procedural (geometria, texturas em canvas, som em WebAudio) a arquivos externos.
- **GIFs do menu B:** os GIFs em `client/public/weapons/gifs/` são pré-renderizados. Se um modelo mudar, regenere em `/tools/gifs.html`.
- **README:** mantenha atualizadas as seções que descrevem cada sistema.
- **Git:** commit e push apenas quando pedido.
