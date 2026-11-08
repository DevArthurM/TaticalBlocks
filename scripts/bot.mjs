#!/usr/bin/env node
/**
 * Bot de teste do modo online: entra numa sala e patrulha saindo da base,
 * mirando, agachando e atirando (sem acertar ninguém — só para ver o soldado).
 *
 *   npm run bot                  → partida rápida 1v1
 *   npm run bot -- 5v5 3         → 3 bots na partida rápida 5v5
 *   npm run bot -- ffa 3         → 3 bots no 1 contra todos
 *   npm run bot -- gungame 2     → 2 bots no Gun Game (usam a arma do nível)
 *   npm run bot -- 1v1 1 <sala>  → entra numa sala específica (id)
 *   URL=ws://host:3000/server npm run bot
 */
import WebSocket from 'ws';

const [mode = '1v1', countArg = '1', room] = process.argv.slice(2);
const URL = process.env.URL ?? 'ws://localhost:3000/server';
const count = Math.max(1, Math.min(19, Number(countArg) || 1));

/** Patrulha (lado azul; o lado verde usa a rotação de 180°). */
const PATH = [
  [0, 23],
  [0, 18],
  [0, 12],
  [-6, 10],
  [6, 10],
  [0, 12],
  [0, 18],
];
const WEAPONS = ['m4a1', 'ak47', 'g17', 'mp5k', 'r870'];

function bot(n) {
  const ws = new WebSocket(URL);
  const send = (event, data = {}) => ws.readyState === 1 && ws.send(JSON.stringify({ event, data }));
  let me = null;
  let team = 'blue';
  let alive = true;
  let pos = [0, 0, 23];
  let target = 1;
  let yaw = 0;
  let t = 0;
  let shotId = 0;
  let weapon = WEAPONS[n % WEAPONS.length];
  const side = () => (team === 'green' ? -1 : 1);

  ws.on('open', () => {
    send('hello', { name: `Bot ${n + 1}` });
    send('join', { mode, room });
  });
  ws.on('message', (raw) => {
    const { event, data } = JSON.parse(String(raw));
    if (event === 'joined') {
      me = data.you.id;
      team = data.you.team;
      pos = data.spawn.p;
      console.log(`[bot ${n + 1}] ${data.you.name} entrou em ${data.room.name} (${data.room.mode}) no time ${team}`);
    } else if (event === 'kill' && data.victim === me) {
      alive = false;
      console.log(`[bot ${n + 1}] abatido`);
    } else if (event === 'respawn' && data.id === me) {
      alive = true;
      pos = data.p;
      target = 1;
    } else if (event === 'gungame') weapon = data.weapon; // Gun Game: arma do nível
    else if (event === 'error') console.log(`[bot ${n + 1}] erro: ${data.message}`);
  });
  ws.on('close', () => {
    console.log(`[bot ${n + 1}] desconectado`);
    process.exitCode = 1;
  });

  const dt = 0.05;
  setInterval(() => {
    if (!me || !alive) return;
    t += dt;
    const [tx, tz] = PATH[target].map((v) => v * side());
    const dx = tx - pos[0];
    const dz = tz - pos[2];
    const dist = Math.hypot(dx, dz);
    const crouch = Math.sin(t * 0.4 + n) > 0.75 ? 1 : 0;
    const aim = Math.sin(t * 0.7 + n * 2) > 0.3;
    const speed = crouch ? 1.6 : aim ? 2.4 : 4.2;
    let v = [0, 0, 0];
    if (dist < 0.3) target = (target + 1) % PATH.length;
    else {
      v = [(dx / dist) * speed, 0, (dz / dist) * speed];
      pos = [pos[0] + v[0] * dt, 0, pos[2] + v[2] * dt];
    }
    // olha para o lado do inimigo, com uma varredura leve
    yaw = (team === 'green' ? Math.PI : 0) + Math.sin(t * 0.5 + n) * 0.6;
    const flags = (crouch ? 1 : 0) | (aim ? 4 : 0) | 8;
    send('state', { p: pos, v, yaw, pitch: Math.sin(t * 0.9) * 0.15, lean: Math.sin(t * 0.3 + n) > 0.85 ? 1 : 0, crouch, flags, weapon });
    // rajadas curtas de vez em quando
    if (aim && Math.sin(t * 3.1 + n) > 0.6) {
      const dir = [-Math.sin(yaw), 0, -Math.cos(yaw)];
      send('shot', { id: ++shotId, weapon, origin: [pos[0], 1.6, pos[2]], dir, pellets: 1 });
    }
  }, dt * 1000);
}

for (let i = 0; i < count; i++) setTimeout(() => bot(i), i * 150);
