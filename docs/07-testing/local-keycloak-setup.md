# Local Keycloak setup for manual testing

This optional profile provides a local-only OIDC provider for testing Ledger
Lite. It exists only for development: it binds to `127.0.0.1`, uses HTTP, and
must never be used for a shared, pilot, or production environment.

It imports two fixed local identities:

| User    | Keycloak username          | Ledger Lite role after provisioning |
| ------- | -------------------------- | ----------------------------------- |
| Owner   | `owner@ledgerlite.local`   | `owner` for the local company       |
| Cashier | `cashier@ledgerlite.local` | branch-scoped `cashier`             |

## Start the local identity provider

Run this in a PowerShell terminal at the repository root. Choose unique local
passwords; the values remain in the current terminal environment and are not
written to Git.

```powershell
$env:LOCAL_OIDC_ADMIN_USERNAME = 'local-admin'
$env:LOCAL_OIDC_ADMIN_PASSWORD = '<local Keycloak admin password>'
$env:LOCAL_OIDC_CLIENT_SECRET = node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
$env:LOCAL_OIDC_OWNER_PASSWORD = '<local owner password>'
$env:LOCAL_OIDC_CASHIER_PASSWORD = '<local cashier password>'

docker compose -f infra/compose/docker-compose.yml --profile local-oidc up -d keycloak
```

Wait until `docker compose -f infra/compose/docker-compose.yml logs keycloak`
shows the server has started. The local Keycloak console is then available at
`http://localhost:8080`. Do not expose that port on a network.

Keycloak imports the realm only when it does not already exist. To recreate
this disposable realm, first run:

```powershell
docker compose -f infra/compose/docker-compose.yml --profile local-oidc rm -sf keycloak
```

Then start it again with a fresh set of local environment values.

## Start Ledger Lite with local OIDC

In the same terminal, set the API configuration and start the API. Keep this
terminal open while testing.

```powershell
$env:DATABASE_URL = 'postgresql://ledgerlite:ledgerlite@localhost:5432/ledgerlite'
$env:REDIS_URL = 'redis://localhost:6379'
$env:NODE_ENV = 'development'
$env:WEB_APP_ORIGIN = 'http://localhost:3000'
$env:OIDC_ISSUER_URL = 'http://localhost:8080/realms/ledgerlite-local'
$env:OIDC_CLIENT_ID = 'ledgerlite-web'
$env:OIDC_CLIENT_SECRET = $env:LOCAL_OIDC_CLIENT_SECRET
$env:OIDC_REDIRECT_URI = 'http://localhost:3001/api/v1/auth/callback'
$env:OIDC_TRANSACTION_ENCRYPTION_KEY = node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
$env:POS_OFFLINE_GRANT_SIGNING_PRIVATE_JWK = node -e "const { webcrypto } = require('node:crypto'); (async () => { const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']); console.log(JSON.stringify(await webcrypto.subtle.exportKey('jwk', keys.privateKey))); })();"
$env:POS_OFFLINE_GRANT_SIGNING_KEY_ID = 'local-offline-grant-20260729'
$env:POS_PIN_PEPPER = node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"

corepack pnpm --filter @ledgerlite/db migrate
node apps/api/dist/main.js
```

Start the web app in a second terminal if it is not already running:

```powershell
corepack pnpm --filter @ledgerlite/web start
```

## Provision the local owner and cashier

In a third terminal, provision the two imported OIDC identities. The owner
command prints `companyId` and `branchId`; retain those two non-secret IDs only
for this local test.

```powershell
$env:DATABASE_URL = 'postgresql://ledgerlite:ledgerlite@localhost:5432/ledgerlite'
$env:PILOT_PROVISIONING_REFERENCE = 'LOCAL-OIDC-OWNER-20260729'
$env:PILOT_OWNER_IDENTITY_PROVIDER = 'http://localhost:8080/realms/ledgerlite-local'
$env:PILOT_OWNER_EXTERNAL_SUBJECT = '10000000-0000-4000-8000-000000000001'
$env:PILOT_OWNER_DISPLAY_NAME = 'Local Owner'
$env:PILOT_COMPANY_LEGAL_NAME = 'Ledger Lite Local Retail LLC'
$env:PILOT_BRANCH_CODE = 'MAIN'
$env:PILOT_BRANCH_NAME = 'Main Branch'
corepack pnpm --filter @ledgerlite/db provision:pilot-owner
```

Set the two IDs from the owner command, then grant the cashier access:

```powershell
$env:PILOT_STAFF_PROVISIONING_REFERENCE = 'LOCAL-OIDC-CASHIER-20260729'
$env:PILOT_STAFF_ACCESS_ACTION = 'grant'
$env:PILOT_STAFF_COMPANY_ID = '<companyId from the owner command>'
$env:PILOT_STAFF_BRANCH_ID = '<branchId from the owner command>'
$env:PILOT_STAFF_IDENTITY_PROVIDER = 'http://localhost:8080/realms/ledgerlite-local'
$env:PILOT_STAFF_EXTERNAL_SUBJECT = '10000000-0000-4000-8000-000000000002'
$env:PILOT_STAFF_DISPLAY_NAME = 'Local Cashier'
$env:PILOT_STAFF_ROLE = 'cashier'
corepack pnpm --filter @ledgerlite/db provision:pilot-staff
```

## Test sequence

1. Open `http://localhost:3000` and sign in as the local owner.
2. Run the catalogue and accounting steps in the [manual tester guide](../06-delivery/manual-tester-guide.md).
3. Open a separate browser profile or private window and sign in as the local
   cashier. Do not use an owner session to test cashier permissions.
4. Follow [US-031](us-031-local-sale-outbox.md), then [US-032](us-032-sale-sync.md).

Stop or remove the local profile when finished. Local users, passwords,
client-secret values, generated device keys, and authorization grants are not
portable test evidence.
