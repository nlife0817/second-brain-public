// Установка пароля по одноразовой ссылке. Публичный путь (см. PUBLIC_PATHS в
// proxy.ts): сюда приходит именно тот, кто войти пока не может.
//
// Проверку токена делает сервер: незачем отдавать браузеру форму, которая
// заведомо упрётся в «ссылка недействительна» после первого же нажатия.

import Link from "next/link";
import { peekPasswordToken } from "@/lib/core/credentials";
import { SetPasswordForm } from "./SetPasswordForm";

export default async function SetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const target = await peekPasswordToken(token);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card px-6 py-10 shadow-sm">
        {!target ? (
          <>
            <h1 className="font-heading text-xl font-semibold tracking-tight">Ссылка недействительна</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Ссылка устарела или уже использована. Попросите владельца организации выдать новую.
            </p>
            <Link href="/login" className="mt-4 inline-block text-sm text-primary underline">
              Перейти ко входу
            </Link>
          </>
        ) : (
          <SetPasswordForm token={token} email={target.email} name={target.name} />
        )}
      </div>
    </div>
  );
}
