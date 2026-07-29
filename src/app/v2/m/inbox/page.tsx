import { getActiveOrgAuth } from "@/lib/core/bootstrap";
import { listNotifications } from "@/lib/core/events";
import { MobileInboxClient } from "./MobileInboxClient";

export default async function MobileInboxPage() {
  const auth = await getActiveOrgAuth();
  if (!auth) return null;
  const items = await listNotifications(auth.orgId, auth.user.id, { unreadOnly: false });
  return <MobileInboxClient initial={items} />;
}
