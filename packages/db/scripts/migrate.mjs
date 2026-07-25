import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const migrationDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../db/migrations",
);
const lockName = "ledgerlite_schema_migrations";
const isBaseline = process.argv.slice(2).join(" ") === "--baseline";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://ledgerlite:ledgerlite@localhost:5432/ledgerlite";

function checksum(sql) {
  return createHash("sha256").update(sql).digest("hex");
}

async function loadMigrations() {
  const filenames = (await readdir(migrationDirectory))
    .filter((filename) => /^\d{6}_[a-z0-9_]+\.sql$/.test(filename))
    .sort();

  if (filenames.length === 0) {
    throw new Error("No SQL migrations were found.");
  }

  return Promise.all(
    filenames.map(async (filename) => ({
      filename,
      sql: await readFile(join(migrationDirectory, filename), "utf8"),
    })),
  );
}

async function initializeLedger(client) {
  await client.query("CREATE SCHEMA IF NOT EXISTS platform");
  await client.query(`
    CREATE TABLE IF NOT EXISTS platform.schema_migration (
      filename text PRIMARY KEY,
      checksum char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function assertBaselineIsSafe(client) {
  const result = await client.query(`
    SELECT
      to_regclass('platform.company') AS company_table,
      to_regclass('catalog.product') AS product_table,
      to_regclass('catalog.price_list_item') AS price_item_table,
      to_regprocedure('platform.touch_updated_at()') AS touch_function
  `);
  const schema = result.rows[0];

  if (Object.values(schema).some((value) => value === null)) {
    throw new Error(
      "Baseline requires a database that already has every Ledger Lite migration applied.",
    );
  }
}

async function assertEmptyLedgerIsSafe(client) {
  const result = await client.query(`
    SELECT EXISTS (
      SELECT 1
      FROM platform.schema_migration
    ) AS has_history,
    to_regclass('platform.company') AS company_table
  `);
  const { has_history: hasHistory, company_table: companyTable } =
    result.rows[0];

  if (!hasHistory && companyTable !== null) {
    throw new Error(
      "This database already contains Ledger Lite tables but has no migration ledger. Run migrate:baseline only after verifying its migration state.",
    );
  }
}

async function recordOrApplyMigrations(client, migrations) {
  for (const migration of migrations) {
    const migrationChecksum = checksum(migration.sql);
    const existing = await client.query(
      "SELECT checksum FROM platform.schema_migration WHERE filename = $1",
      [migration.filename],
    );

    if (existing.rows[0]) {
      if (existing.rows[0].checksum !== migrationChecksum) {
        throw new Error(
          `Migration ${migration.filename} has changed after it was applied. Add a new corrective migration instead.`,
        );
      }
      continue;
    }

    if (isBaseline) {
      await client.query(
        "INSERT INTO platform.schema_migration (filename, checksum) VALUES ($1, $2)",
        [migration.filename, migrationChecksum],
      );
      process.stdout.write(
        `Recorded existing migration ${migration.filename}\n`,
      );
      continue;
    }

    try {
      await client.query("BEGIN");
      await client.query(migration.sql);
      await client.query(
        "INSERT INTO platform.schema_migration (filename, checksum) VALUES ($1, $2)",
        [migration.filename, migrationChecksum],
      );
      await client.query("COMMIT");
      process.stdout.write(`Applied ${migration.filename}\n`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
}

const pool = new Pool({ connectionString });
const client = await pool.connect();

try {
  await client.query("SELECT pg_advisory_lock(hashtext($1))", [lockName]);
  await initializeLedger(client);

  if (isBaseline) {
    await assertBaselineIsSafe(client);
  } else {
    await assertEmptyLedgerIsSafe(client);
  }

  await recordOrApplyMigrations(client, await loadMigrations());
} finally {
  await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockName]);
  client.release();
  await pool.end();
}
