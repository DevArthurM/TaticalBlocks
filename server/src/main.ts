import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`Servidor do FPS rodando em http://localhost:${port}/api`, 'Bootstrap');
}

void bootstrap();
