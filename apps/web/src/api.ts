import { QueryClient } from '@tanstack/react-query';
import type { SessionInfo } from '@releasedesk/contracts';
export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});
let csrf = '';
export class ApiFailure extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(method === 'GET' ? {} : { 'x-csrf-token': csrf }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  const result = await response.json().catch(() => ({
    error: { message: 'The server is unavailable. Please retry.', code: 'UNAVAILABLE' },
  }));
  if (!response.ok) {
    if (response.status === 401) void queryClient.invalidateQueries({ queryKey: ['session'] });
    throw new ApiFailure(
      result.error?.message ?? 'The request failed.',
      result.error?.code ?? 'UNKNOWN',
      response.status,
    );
  }
  return result;
}
export async function getSession() {
  const info = await api<SessionInfo>('/auth/session');
  csrf = info.csrfToken;
  return info;
}
export async function refreshSession() {
  queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' });
  const info = await getSession();
  queryClient.setQueryData(['session'], info);
  return info;
}
