import { NotificationsSettings } from "@/components/settings/NotificationsSettings";
import { TimingSettingsCard } from "@/components/timing/TimingSettings";

export default function MobileSettingsPage() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex items-center gap-2">
        <h1 className="text-lg font-semibold">Настройки</h1>
      </header>
      <NotificationsSettings />
      <TimingSettingsCard />
    </div>
  );
}
