import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';

/** O mínimo do Express usado aqui (sem depender de @types/express). */
interface Req {
  method: string;
  path: string;
}
interface Res {
  sendFile(path: string): void;
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors();
  // WebSocket do modo online no mesmo servidor HTTP (caminho /server)
  app.useWebSocketAdapter(new WsAdapter(app));

  // produção (Docker): o mesmo servidor entrega o jogo compilado (client/dist) em `/`
  const clientDir = resolve(process.env.CLIENT_DIR ?? join(__dirname, '../../../../client/dist'));
  const serveClient = existsSync(join(clientDir, 'index.html'));
  if (serveClient) {
    app.useStaticAssets(clientDir, { index: 'index.html', maxAge: '1h' });
    // qualquer outra rota (fora de /api e /server) volta para o jogo
    app.use((req: Req, res: Res, next: () => void) => {
      if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/server')) return next();
      res.sendFile(join(clientDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`Servidor do TaticalBlocks rodando em http://localhost:${port}/api (online: ws://localhost:${port}/server)`, 'Bootstrap');
  if (serveClient) Logger.log(`Jogo em http://localhost:${port}/ (arquivos de ${clientDir})`, 'Bootstrap');
}

void bootstrap();
