import { prisma } from "./prisma.js";

export async function logAdminAction(params: {
  actorEmail: string;
  action: "block" | "unblock" | "set_plan" | "delete" | "impersonate";
  targetBusinessId: string;
  targetBusinessName: string;
  details?: string;
}) {
  await prisma.adminAuditLog.create({
    data: {
      actorEmail: params.actorEmail,
      action: params.action,
      targetBusinessId: params.targetBusinessId,
      targetBusinessName: params.targetBusinessName,
      details: params.details,
    },
  });
}
