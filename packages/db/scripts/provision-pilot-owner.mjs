import process from "node:process";
import {
  provisionPilotCompany,
  readPilotProvisioningInput,
} from "./pilot-provisioning.mjs";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://ledgerlite:ledgerlite@localhost:5432/ledgerlite";

try {
  const result = await provisionPilotCompany({
    connectionString,
    input: readPilotProvisioningInput(),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write(`Pilot provisioning failed: ${message}\n`);
  process.exitCode = 1;
}
