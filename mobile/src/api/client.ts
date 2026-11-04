import Constants from 'expo-constants';

import { DemoError, demoApi } from '../demo/server';

/** The shareable web demo (EXPO_PUBLIC_DEMO=1) runs the API inside the page. */
export const DEMO = process.env.EXPO_PUBLIC_DEMO === '1';

/** Resolve the API base URL: EXPO_PUBLIC_API_URL, then app.json extra.apiUrl, then the
 * machine running the Expo dev server (so a phone on the same Wi-Fi just works). */
function resolveApiUrl(): string {
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
  const explicit = text(process.env.EXPO_PUBLIC_API_URL) ?? text(Constants.expoConfig?.extra?.apiUrl);
  if (explicit) return explicit.replace(/\/$/, '');
  const host = text(Constants.expoConfig?.hostUri)?.split(':')[0];
  return host ? `http://${host}:8000` : 'http://localhost:8000';
}

export const API_URL = resolveApiUrl();

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, message: string, detail: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

let token: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAuthToken(value: string | null) {
  token = value;
}

export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

type Query = Record<string, string | number | boolean | null | undefined>;

function queryString(query?: Query): string {
  if (!query) return '';
  const parts = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

function messageFrom(status: number, data: any): string {
  const detail = data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail.map((d) => `${(d.loc ?? []).slice(1).join('.')}: ${d.msg}`).join('\n');
  }
  if (detail?.message) {
    const extra = Array.isArray(detail.blocked_by) ? `\n• ${detail.blocked_by.join('\n• ')}` : '';
    return `${detail.message}${extra}`;
  }
  return `Request failed (${status})`;
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; query?: Query } = {},
): Promise<T> {
  const { method = 'GET', body, query } = options;
  if (DEMO) {
    const q = Object.fromEntries(
      Object.entries(query ?? {})
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => [k, String(v)]),
    );
    try {
      return (await demoApi(method, path, q, body)) as T;
    } catch (e) {
      if (e instanceof DemoError) throw new ApiError(e.status, messageFrom(e.status, { detail: e.detail }), e.detail);
      throw e;
    }
  }
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/v1${path}${queryString(query)}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, `Cannot reach the SettleWise server at ${API_URL}`, null);
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized?.();
    throw new ApiError(res.status, messageFrom(res.status, data), data?.detail);
  }
  return data as T;
}
