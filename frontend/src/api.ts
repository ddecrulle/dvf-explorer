import { i18n } from './i18n';
import { translateMessage } from './messages';
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Fetch a typed API response, preserving actionable server error messages. */
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, options);
  if (!response.ok) {
    let detail: unknown;
    try {
      const body: { detail?: unknown } = await response.json();
      detail = body.detail;
    } catch {
      // Proxies can return plain text or HTML instead of the API's JSON errors.
    }
    throw new ApiError(
      typeof detail === 'string'
        ? detail
        : `The service is unavailable (${response.status}).`,
      response.status,
    );
  }
  return response.json() as Promise<T>;
}
export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? translateMessage(error.message)
    : i18n.t('errors.unexpected');
}
