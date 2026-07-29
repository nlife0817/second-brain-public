/**
 * Русское согласование числительного: «1 задача», «2 задачи», «5 задач».
 * Нужно и напоминаниям, и сводным пушам — текст «3 задача» выдаёт машину
 * вернее любого другого признака.
 */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} ${one}`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
}
