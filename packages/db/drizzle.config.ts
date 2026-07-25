import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/**/*.ts',
  out: '../../db/drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
