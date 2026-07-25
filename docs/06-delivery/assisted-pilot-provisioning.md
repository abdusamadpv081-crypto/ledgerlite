# Assisted pilot provisioning

## Scope

Ledger Lite's pilot uses **assisted/operator provisioning**, not public
self-signup. An operator provisions the first active company owner before that
person uses the OIDC login flow. This prevents an arbitrary identity-provider
account from creating a Ledger Lite company or gaining access merely by signing
in.

The operator command creates one atomic, auditable unit:

1. The `platform.app_user` identity record, if it does not already exist and
   is active.
2. A company and its first branch.
3. An active company membership and company-wide `owner` role.
4. An immutable system `audit.event` with action `company.provisioned`.
5. An immutable `platform.company_provisioning` record tied to the external
   operations reference.

The record is idempotent: repeating the exact provisioning reference for the
same OIDC identity returns the already-created company, branch, and owner IDs.
It never makes a second company.

## Prerequisites

- Apply all database migrations with the migration role.
- Configure the same OIDC issuer that the pilot owner will use. The value of
  `PILOT_OWNER_IDENTITY_PROVIDER` must exactly match the issuer URL stored by
  the OIDC adapter, including any trailing slash.
- Obtain the owner's OIDC `sub` from the identity provider's verified
  administration path. Do not ask the owner to send access tokens, ID tokens,
  passwords, or MFA codes.
- Use a dedicated operator database login that may `SET ROLE
ledgerlite_operator`. Never run this command with the runtime API database
  login or from a developer laptop against production.
- Store the operations reference and customer approval in the pilot/support
  ticket before provisioning.

## Run the command

Set values through your approved secret/operations environment. The PowerShell
example below is for a non-production environment; never paste production
connection strings or identity details into a shell history, chat, or source
file.

```powershell
$env:DATABASE_URL = '<operator database connection string>'
$env:PILOT_PROVISIONING_REFERENCE = 'OPS-1234'
$env:PILOT_OWNER_IDENTITY_PROVIDER = 'https://identity.example.com/'
$env:PILOT_OWNER_EXTERNAL_SUBJECT = '<verified OIDC subject>'
$env:PILOT_OWNER_DISPLAY_NAME = 'Pilot owner name'
$env:PILOT_COMPANY_LEGAL_NAME = 'Pilot Retail LLC'
$env:PILOT_BRANCH_CODE = 'MAIN'
$env:PILOT_BRANCH_NAME = 'Main branch'
corepack pnpm --filter @ledgerlite/db provision:pilot-owner
```

Optional values default to UAE pilot settings:

| Variable                        | Default      |
| ------------------------------- | ------------ |
| `PILOT_COMPANY_BASE_CURRENCY`   | `AED`        |
| `PILOT_COMPANY_TIME_ZONE`       | `Asia/Dubai` |
| `PILOT_FISCAL_YEAR_START_MONTH` | `1`          |

The command prints only `created`, `companyId`, `branchId`, and `ownerUserId`.
Record those identifiers in the protected pilot ticket. It never prints a
session, OIDC token, password, PIN, or encryption key.

## Validate and recover

1. Repeat the command with the same reference as an idempotency check; it must
   return `created: false` and the same IDs.
2. Have the owner complete OIDC sign-in over HTTPS. The owner may then receive
   a server browser session, but cannot use business functions until those APIs
   are introduced with capability guards.
3. If identity/company information is wrong, do not edit or delete the audit
   event or provisioning record. Open a corrective operations ticket and use a
   reviewed remediation procedure. Identity disablement, access changes, and
   invitation workflows remain separate follow-on work.

## Security boundary

`ledgerlite_operator` is directly granted only the operator provisioning record
access and is allowed to assume the least-privilege `ledgerlite_app` role inside
the atomic provisioning transaction. The runtime application role has no grant
on `platform.company_provisioning`. This separation is tested in the database
suite.
