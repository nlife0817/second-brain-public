import { redirect } from "next/navigation";

// Корень сохранён как редирект: на него завязаны start_url установленных PWA,
// дефолт push-уведомлений в sw.js и `next` по умолчанию в /login и /auth/callback.
export default function Home() {
  redirect("/v2/my");
}
