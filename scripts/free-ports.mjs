#!/usr/bin/env node
/**
 * Encerra qualquer processo escutando nas portas informadas e espera elas liberarem.
 * Uso: node scripts/free-ports.mjs 3000 5173
 */
import { execSync } from 'node:child_process';
import net from 'node:net';

const ports = process.argv.slice(2).map(Number).filter(Boolean);
const isWin = process.platform === 'win32';

function run(cmd) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  } catch {
    return '';
  }
}

function pidsOnPort(port) {
  if (isWin) {
    return [
      ...new Set(
        run(`netstat -ano -p tcp`)
          .split('\n')
          .filter((l) => l.includes(`:${port} `) && /LISTENING/i.test(l))
          .map((l) => l.trim().split(/\s+/).pop()),
      ),
    ].filter((p) => p && p !== '0');
  }
  const out = run(`lsof -ti tcp:${port} -sTCP:LISTEN`) || run(`fuser ${port}/tcp 2>/dev/null`);
  return [...new Set(out.split(/\s+/).filter((p) => /^\d+$/.test(p)))].filter((p) => Number(p) !== process.pid);
}

function kill(pid, force) {
  if (isWin) run(`taskkill /PID ${pid} /T ${force ? '/F' : ''}`);
  else {
    try {
      process.kill(Number(pid), force ? 'SIGKILL' : 'SIGTERM');
    } catch {
      /* já morreu */
    }
  }
}

function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const port of ports) {
  let pids = pidsOnPort(port);
  if (!pids.length && (await portFree(port))) continue;
  console.log(`[free-ports] porta ${port} ocupada por PID ${pids.join(', ') || '?'} — encerrando...`);
  pids.forEach((p) => kill(p, false));
  for (let i = 0; i < 20 && !(await portFree(port)); i++) {
    await sleep(150);
    if (i === 10) pidsOnPort(port).forEach((p) => kill(p, true)); // não saiu com SIGTERM → força
  }
  if (!(await portFree(port))) {
    console.error(`[free-ports] não foi possível liberar a porta ${port}`);
    process.exit(1);
  }
  console.log(`[free-ports] porta ${port} liberada`);
}
