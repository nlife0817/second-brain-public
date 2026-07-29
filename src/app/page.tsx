import { redirect } from "next/navigation";

// Корень сохранён как редирект: на него завязаны start_url установленных PWA,
// дефолт push-уведомлений в sw.js и `next` по умолчанию в /login и /auth/callback.
// В обычном потоке сюда не доходит — proxy уводит "/" раньше (legacyTarget), —
// но без этого файла у приложения не было бы корневой страницы вовсе.
export default function Home() {
  redirect("/v2/my");
}
