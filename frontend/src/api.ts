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
    throw new Error(
      typeof detail === 'string'
        ? detail
        : `The service is unavailable (${response.status}).`,
    );
  }
  return response.json() as Promise<T>;
}
export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'An unexpected error occurred.';
}
