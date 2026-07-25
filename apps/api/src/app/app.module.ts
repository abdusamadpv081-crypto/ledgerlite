import { Module } from "@nestjs/common";
import { AppController } from "./app.controller.js";
import { CatalogController } from "../catalog/catalog.controller.js";

@Module({
  controllers:
    process.env.LEDGERLITE_ENABLE_DEVELOPMENT_CATALOG === "true"
      ? [AppController, CatalogController]
      : [AppController],
})
export class AppModule {}
