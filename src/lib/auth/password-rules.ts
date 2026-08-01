// Требования к паролю — отдельно от самого хеширования.
//
// `password.ts` тянет `node:crypto` и в браузерный бандл попасть не может, а
// формы установки пароля обязаны показывать те же ограничения, что проверит
// сервер. Модуль без серверных зависимостей — единственный способ иметь одно
// определение на обе стороны.

/** Минимальная длина пароля. */
export const PASSWORD_MIN_LENGTH = 10;

/**
 * Верхняя граница: scrypt считает от длины входа, и без неё запрос с мегабайтным
 * «паролем» становится дешёвым способом занять процессор сервера.
 */
export const PASSWORD_MAX_LENGTH = 200;

/** Человеко-читаемая причина, почему пароль не годится, или null. */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Пароль должен быть не короче ${PASSWORD_MIN_LENGTH} символов`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Пароль не длиннее ${PASSWORD_MAX_LENGTH} символов`;
  }
  return null;
}
