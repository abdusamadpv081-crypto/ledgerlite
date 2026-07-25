import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app/app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
  app.setGlobalPrefix('api/v1');

  const openApi = new DocumentBuilder().setTitle('Ledger Lite API').setVersion('1.0.0').build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, openApi));

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen({ host: '0.0.0.0', port });
  Logger.log(`Ledger Lite API listening on ${port}`, 'Bootstrap');
}

void bootstrap();
