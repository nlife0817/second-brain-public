import { getActiveOrgAuth } from "@/lib/core/bootstrap";
import { listNotifications } from "@/lib/core/events";
import { InboxClient } from "./InboxClient";

export default async function InboxPage() {
  const auth = await getActiveOrgAuth();
  if (!auth) return null;
  const items = await listNotifications(auth.orgId, auth.user.id, { unreadOnly: false });
  return <InboxClient initial={items} />;
}
