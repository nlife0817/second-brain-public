// Настройки: до шести запросов после гидрации (поля, приглашения, вебхуки,
// команды, аудит) — теперь один серверный проход.
//
// Состав разделов задаёт владелец организации (`settings-sections.ts`), поэтому
// и выборки идут только по тем разделам, которые эта роль увидит: тянуть
// вебхуки сотруднику, который их не увидит, — лишний поход в базу, а гостю
// это ещё и 403 вместо экрана.

import { getActiveOrgAuth } from "@/lib/core/bootstrap";
import { listFields } from "@/lib/core/fields";
import { getOrganization, listInvitations } from "@/lib/core/identity";
import { canOrg } from "@/lib/core/policy";
import { listOrgAudit, listWebhooks } from "@/lib/core/saas";
import {
  readSectionsConfig,
  visibleSections,
  withDefaults,
  type SettingsSectionId,
} from "@/lib/core/settings-sections";
import { listTeams } from "@/lib/core/teams";
import { SettingsClient } from "./SettingsClient";

/** Столько строк журнала показывает блок настроек; остальное — на /settings/audit. */
const AUDIT_PREVIEW = 20;

export default async function SettingsPage() {
  const auth = await getActiveOrgAuth();
  if (!auth) return null;

  const org = await getOrganization(auth.orgId);
  const config = readSectionsConfig(org?.settings);
  const sections = visibleSections(auth.orgRole, config);
  const has = (id: SettingsSectionId) => sections.includes(id);

  const [fields, invitations, teams, webhooks, audit] = await Promise.all([
    has("fields") ? listFields(auth) : Promise.resolve([]),
    has("members") && canOrg(auth, "org.invite") ? listInvitations(auth.orgId) : Promise.resolve([]),
    // Команды живут внутри «Участников», но их список — структура организации:
    // подрядчику он не отдаётся даже при открытом разделе.
    has("members") && canOrg(auth, "clients.view") ? listTeams(auth) : Promise.resolve([]),
    has("webhooks") ? listWebhooks(auth) : Promise.resolve([]),
    has("audit") ? listOrgAudit(auth, { limit: AUDIT_PREVIEW }) : Promise.resolve([]),
  ]);

  return (
    <SettingsClient
      initial={{
        fields,
        invitations,
        teams,
        webhooks,
        audit,
        sections,
        // Настройку видит только тот, кто её правит.
        sectionsConfig: auth.orgRole === "owner" ? withDefaults(config) : null,
      }}
    />
  );
}
