import { prisma } from "../config/database";
import { setAuditSink, type AgentAuditRow } from "./toolRouter";

/**
 * Production audit sink for the agent tool layer.
 *
 * Called once at app start. Each agent attempt becomes an AuditLog row, so the
 * agent's behaviour is queryable with the rest of the app's security history
 * rather than living in a log file that nobody reads.
 *
 * Admin invocations carry the full detail in metadata because they are the rows
 * most likely to be reviewed after an incident.
 */
export function installAgentAuditSink(): void {
  setAuditSink(async (row: AgentAuditRow) => {
    const metadata: Record<string, unknown> = {
      sessionId: row.sessionId,
      toolName: row.toolName,
      permission: row.permission,
      effectiveRole: row.effectiveRole,
      accountRole: row.accountRole,
      confirmationRequired: row.confirmationRequired,
      confirmationStatus: row.confirmationStatus,
      result: row.result,
      isAdminAction: row.isAdminAction,
    };
    if (row.errorCode) metadata.errorCode = row.errorCode;
    if (row.errorMessage) metadata.errorMessage = row.errorMessage;

    await prisma.auditLog.create({
      data: {
        actorId: row.userId,
        actorType: row.isAdminAction ? "ADMIN" : "USER",
        action: `AGENT_${row.result.toUpperCase()}`,
        entityType: "AgentTool",
        entityId: row.toolName,
        metadata: JSON.stringify(metadata),
        ipAddress: row.ip ?? null,
      },
    });
  });
}