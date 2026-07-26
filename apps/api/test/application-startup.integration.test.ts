import "reflect-metadata";

import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { afterEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app/app.module.js";

let application: NestFastifyApplication | undefined;

afterEach(async () => {
  await application?.close();
  application = undefined;
});

describe("application startup", () => {
  it("initializes the complete API module and its authenticated routes", async () => {
    application = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter(),
      { logger: false },
    );
    await application.register(cookie);
    application.setGlobalPrefix("api/v1");
    await application.init();

    const [health, protectedRoute] = await Promise.all([
      application.inject({ method: "GET", url: "/api/v1/health" }),
      application.inject({ method: "GET", url: "/api/v1/auth/me" }),
    ]);

    expect(health.statusCode).toBe(200);
    expect(JSON.parse(health.body)).toEqual({
      service: "ledgerlite-api",
      status: "ok",
    });
    expect(protectedRoute.statusCode).toBe(401);
  });
});
