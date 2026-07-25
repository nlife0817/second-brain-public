// Настройки: до шести запросов после гидрации (поля, приглашения, тариф,
// вебхуки, команды, аудит) — теперь один серверный проход.

import { getActiveOrgAuth } from "@/lib/core/bootstrap";
import { listFields } from "@/lib/core/fields";
import { listInvitations } from "@/lib/core/identity";
import { canOrg } from "@/lib/core/policy";
import { getOrgUsage, listOrgAudit, listWebhooks } from "@/lib/core/saas";
import { listTeams } from "@/lib/core/teams";
import { SettingsClient, type AdminInitial } from "./SettingsClient";

/** Столько строк аудита показывает экран. */
const AUDIT_LIMIT = 15;

export default async function SettingsPage() {
  const auth = await getActiveOrgAuth();
  if (!auth) return null;

  const isAdmin = auth.orgRole === "owner" || auth.orgRole === "admin";

  const [fields, invitations, admin] = await Promise.all([
    listFields(auth),
    canOrg(auth, "org.invite") ? listInvitations(auth.orgId) : Promise.resolve([]),
    isAdmin
      ? (async (): Promise<AdminInitial> => {
          const [usage, webhooks, teams, audit] = await Promise.all([
            getOrgUsage(auth),
            listWebhooks(auth),
            listTeams(auth),
            listOrgAudit(auth, {}),
          ]);
          return { usage, webhooks, teams, audit: audit.slice(0, AUDIT_LIMIT) };
        })()
      : Promise.resolve(null),
  ]);

  return <SettingsClient initial={{ fields, invitations, admin }} />;
}
