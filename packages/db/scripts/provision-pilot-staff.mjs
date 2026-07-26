import process from "node:process";
import {
  provisionPilotStaffAccess,
  readPilotStaffProvisioningInput,
} from "./pilot-staff-provisioning.mjs";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://ledgerlite:ledgerlite@localhost:5432/ledgerlite";

try {
  const result = await provisionPilotStaffAccess({
    connectionString,
    input: readPilotStaffProvisioningInput(),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write(`Pilot staff provisioning failed: ${message}\n`);
  process.exitCode = 1;
}
