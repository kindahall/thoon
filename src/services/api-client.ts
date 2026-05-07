type RequestOptions = {
  method?: 'DELETE' | 'GET' | 'PATCH' | 'POST';
};

export async function apiJson<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(path, {
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    method: options.method ?? (body === undefined ? 'GET' : 'POST'),
  });

  const payload = (await response.json().catch(() => null)) as { error?: string } | T | null;

  if (!response.ok) {
    const errorMessage = typeof payload === 'object' && payload !== null && 'error' in payload ? payload.error : undefined;

    throw new Error(errorMessage || `Request failed: ${response.status}`);
  }

  return payload as T;
}

export function postJson<T>(path: string, body?: unknown) {
  return apiJson<T>(path, body, { method: 'POST' });
}

export function patchJson<T>(path: string, body?: unknown) {
  return apiJson<T>(path, body, { method: 'PATCH' });
}

export function deleteJson<T>(path: string, body?: unknown) {
  return apiJson<T>(path, body, { method: 'DELETE' });
}
