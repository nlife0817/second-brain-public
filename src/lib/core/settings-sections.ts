// Состав экрана «Настройки» по ролям.
//
// Раньше набор разделов был зашит в код: администратор видел одно, сотрудник —
// другое, гость не попадал вовсе. Теперь состав настраивает владелец
// организации, а хранится он в `core.organizations.settings.settings_sections`.
//
// Настройка умеет только сузить видимость, не расширить: у каждого раздела есть
// порог `minRole` — роль, ниже которой его данные всё равно не отдаст policy.
// Открыть сотруднику вебхуки галочкой нельзя; он получил бы 403 вместо раздела.
// Владелец видит всё всегда — иначе он мог бы запереть сам себя.

import { ORG_ROLE_RANK, type OrgRole } from "./types";

export type SettingsSectionId =
  | "members"
  | "statuses"
  | "tags"
  | "fields"
  | "audit"
  | "export"
  | "webhooks";

export interface SettingsSectionMeta {
  id: SettingsSectionId;
  title: string;
  /** Короткое пояснение для владельца в настройке доступа. */
  hint: string;
  /** Порог policy: ниже этой роли раздел не отдаётся независимо от настройки. */
  minRole: OrgRole;
  /** Кому раздел открыт, пока владелец не решил иначе. */
  defaultRoles: OrgRole[];
}

/** Порядок здесь же задаёт порядок разделов на экране. Вебхуки — последние. */
export const SETTINGS_SECTIONS: SettingsSectionMeta[] = [
  {
    id: "members",
    title: "Участники",
    hint: "Состав организации, роли, приглашения и команды",
    minRole: "guest",
    defaultRoles: ["admin", "member"],
  },
  {
    id: "statuses",
    title: "Статусы задач",
    hint: "Справочник статусов; менять их может администратор",
    minRole: "guest",
    defaultRoles: ["admin", "member"],
  },
  {
    id: "tags",
    title: "Теги",
    hint: "Справочник тегов организации",
    minRole: "guest",
    defaultRoles: ["admin", "member"],
  },
  {
    id: "fields",
    title: "Кастомные поля",
    hint: "Поля задач, общие для всей организации",
    minRole: "guest",
    defaultRoles: ["admin", "member"],
  },
  {
    id: "audit",
    title: "Журнал действий",
    hint: "Кто и что менял в организации",
    minRole: "admin",
    defaultRoles: ["admin"],
  },
  {
    id: "export",
    title: "Данные организации",
    hint: "Выгрузка всех данных организации в JSON",
    minRole: "admin",
    defaultRoles: ["admin"],
  },
  {
    id: "webhooks",
    title: "Вебхуки",
    hint: "Исходящие уведомления во внешние системы",
    minRole: "admin",
    defaultRoles: ["admin"],
  },
];

/** Роли, которые владелец настраивает. Себя он не настраивает — видит всё. */
export const CONFIGURABLE_ROLES: OrgRole[] = ["admin", "member", "guest"];

export const ORG_ROLE_LABELS: Record<OrgRole, string> = {
  owner: "Владелец",
  admin: "Администратор",
  member: "Сотрудник",
  guest: "Гость",
};

export type SettingsSectionsConfig = Partial<Record<SettingsSectionId, OrgRole[]>>;

/** Ключ внутри `organizations.settings`. */
export const SETTINGS_SECTIONS_KEY = "settings_sections";

const SECTION_IDS = new Set<string>(SETTINGS_SECTIONS.map((s) => s.id));
const ROLES = new Set<string>(["owner", "admin", "member", "guest"]);

/**
 * Настройка из `organizations.settings`. jsonb — обещание, а не тип: форму
 * проверяем здесь, иначе чужая запись в колонке уронит экран настроек.
 */
export function readSectionsConfig(settings: unknown): SettingsSectionsConfig {
  const raw = (settings as Record<string, unknown> | null | undefined)?.[SETTINGS_SECTIONS_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: SettingsSectionsConfig = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!SECTION_IDS.has(key) || !Array.isArray(value)) continue;
    out[key as SettingsSectionId] = value.filter((r): r is OrgRole => typeof r === "string" && ROLES.has(r));
  }
  return out;
}

/** Полная настройка: незаданные разделы добираются умолчаниями. */
export function withDefaults(config: SettingsSectionsConfig): Record<SettingsSectionId, OrgRole[]> {
  const out = {} as Record<SettingsSectionId, OrgRole[]>;
  for (const section of SETTINGS_SECTIONS) {
    out[section.id] = config[section.id] ?? section.defaultRoles;
  }
  return out;
}

export function canSeeSection(
  role: OrgRole,
  section: SettingsSectionMeta,
  config: SettingsSectionsConfig,
): boolean {
  if (role === "owner") return true;
  if (ORG_ROLE_RANK[role] < ORG_ROLE_RANK[section.minRole]) return false;
  return (config[section.id] ?? section.defaultRoles).includes(role);
}

export function visibleSections(role: OrgRole, config: SettingsSectionsConfig): SettingsSectionId[] {
  return SETTINGS_SECTIONS.filter((s) => canSeeSection(role, s, config)).map((s) => s.id);
}
