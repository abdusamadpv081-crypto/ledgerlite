import {
  ForbiddenException,
  Inject,
  Injectable,
  type OnApplicationShutdown,
} from "@nestjs/common";
import {
  ROLE_TEMPLATES,
  roleGrantsCapability,
  type Capability,
  type CapabilityScope,
  type RoleTemplate,
} from "@ledgerlite/domain";
import { Pool, type PoolClient } from "pg";

export const AUTHORIZATION_POOL = Symbol("AUTHORIZATION_POOL");

export type AuthorizationContext = Readonly<{
  actorUserId: string;
  companyId: string;
  branchId?: string;
}>;

type RoleAssignment = Readonly<{
  role_template: RoleTemplate;
  branch_id: string | null;
}>;

function isRoleTemplate(value: string): value is RoleTemplate {
  return ROLE_TEMPLATES.includes(value as RoleTemplate);
}

export function createAuthorizationPool(): Pool {
  return new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      "postgresql://ledgerlite:ledgerlite@localhost:5432/ledgerlite",
  });
}

@Injectable()
export class AuthorizationService implements OnApplicationShutdown {
  constructor(@Inject(AUTHORIZATION_POOL) private readonly pool: Pool) {}

  async assertCapability(
    context: AuthorizationContext,
    capability: Capability,
  ): Promise<void> {
    const assignments = await this.activeAssignments(context);
    const isAuthorized = assignments.some((assignment) => {
      if (!roleGrantsCapability(assignment.role_template, capability)) {
        return false;
      }

      const scope: CapabilityScope =
        assignment.role_template === "owner" ||
        assignment.role_template === "accountant"
          ? "company"
          : "branch";

      return (
        scope === "company" ||
        (context.branchId !== undefined &&
          assignment.branch_id === context.branchId)
      );
    });

    if (!isAuthorized) {
      throw new ForbiddenException("Capability is not granted for this scope.");
    }
  }

  private async activeAssignments(
    context: AuthorizationContext,
  ): Promise<readonly RoleAssignment[]> {
    return this.withTenantContext(context, async (client) => {
      if (context.branchId !== undefined) {
        const branch = await client.query(
          "SELECT id FROM platform.branch WHERE id = $1",
          [context.branchId],
        );
        if (branch.rowCount !== 1) {
          return [];
        }
      }

      const result = await client.query<{
        role_template: string;
        branch_id: string | null;
      }>(
        `SELECT assignment.role_template, assignment.branch_id
         FROM platform.company_user AS membership
         JOIN platform.app_user AS app_user
           ON app_user.id = membership.user_id
         JOIN platform.role_assignment AS assignment
           ON assignment.company_id = membership.company_id
          AND assignment.company_user_id = membership.id
         WHERE membership.user_id = $1
           AND app_user.status = 'active'
           AND membership.status = 'active'
           AND membership.effective_from <= now()
           AND (membership.effective_until IS NULL OR membership.effective_until > now())
           AND assignment.effective_from <= now()
           AND (assignment.effective_until IS NULL OR assignment.effective_until > now())`,
        [context.actorUserId],
      );

      return result.rows.map((row) => {
        if (!isRoleTemplate(row.role_template)) {
          throw new Error("Unexpected role template in authorization data.");
        }
        return { role_template: row.role_template, branch_id: row.branch_id };
      });
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }

  private async withTenantContext<T>(
    context: AuthorizationContext,
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('app.current_company_id', $1, true)",
        [context.companyId],
      );
      await client.query(
        "SELECT set_config('app.current_actor_id', $1, true)",
        [context.actorUserId],
      );
      await client.query("SET LOCAL ROLE ledgerlite_app");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
