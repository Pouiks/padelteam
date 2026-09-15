/** Appels à l'API : JSON dans les deux sens, erreurs converties en messages lisibles. */

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function api<T = unknown>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'Serveur injoignable. Vérifie ta connexion.');
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // corps vide ou non JSON
  }
  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error || `Erreur ${res.status}`;
    throw new ApiError(res.status, message);
  }
  return data as T;
}
