import { Inject, Injectable } from "@nestjs/common";
import { Pool, type PoolClient } from "pg";
import { AUTHORIZATION_POOL } from "./authorization.service.js";

export type ActiveCompanyContext = Readonly<{
  companyId: string;
  legalName: string;
  tradeName: string | null;
  status: "active";
  roles: readonly string[];
}>;

@Injectable()
export class CompanyContextService {
  constructor(@Inject(AUTHORIZATION_POOL) private readonly pool: Pool) {}

  async listForActor(
    actorUserId: string,
  ): Promise<readonly ActiveCompanyContext[]> {
    return this.withActor(actorUserId, async (client) => {
      const result = await client.query<{
        company_id: string;
        legal_name: string;
        trade_name: string | null;
        company_status: "active";
        roles: string[];
      }>("SELECT * FROM platform.list_active_company_contexts()");
      return result.rows.map((row) => ({
        companyId: row.company_id,
        legalName: row.legal_name,
        tradeName: row.trade_name,
        status: row.company_status,
        roles: row.roles,
      }));
    });
  }

  private async withActor<T>(
    actorUserId: string,
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('app.current_actor_id', $1, true)",
        [actorUserId],
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
