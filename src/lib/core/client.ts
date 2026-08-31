// Браузерный клиент API v2. Все пути — относительно /api/v2.

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  // FormData уходит как есть: заголовок ей ставит браузер вместе с границей
  // частей, а `Content-Type` вручную сломал бы разбор на сервере.
  const form = body instanceof FormData;
  const res = await fetch(`/api/v2${path}`, {
    method,
    headers: body !== undefined && !form ? { "Content-Type": "application/json" } : undefined,
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
  });
  return unwrap<T>(res);
}

async function unwrap<T>(res: Response): Promise<T> {
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // пустой ответ
  }
  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  /**
   * Файл — multipart, а не JSON: base64 раздул бы его на треть и заставил
   * держать в памяти дважды.
   */
  upload: <T>(path: string, form: FormData) => request<T>("POST", path, form),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};
