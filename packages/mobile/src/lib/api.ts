import axios, { AxiosError } from 'axios';
import { API_URL } from './env';
import { tokenStore } from './storage';
import { useAuthStore } from '../shared/store/authStore';

// Standard API envelope: { success, data, message, error, extra }
export interface ApiEnvelope<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  extra?: Record<string, any>;
}

export const api = axios.create({
  baseURL: API_URL,
  timeout: 20000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = tokenStore.getAccessToken();
  if (token) {
    config.headers = config.headers ?? {};
    (config.headers as any).Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError<ApiEnvelope>) => {
    if (error.response?.status === 401) {
      // Token expired or invalid — clear local session.
      tokenStore.clear();
      useAuthStore.getState().logout();
    }
    return Promise.reject(error);
  }
);

export async function post<T = any>(path: string, body?: any): Promise<ApiEnvelope<T>> {
  const res = await api.post<ApiEnvelope<T>>(path, body);
  return res.data;
}

export async function get<T = any>(path: string, params?: any): Promise<ApiEnvelope<T>> {
  const res = await api.get<ApiEnvelope<T>>(path, { params });
  return res.data;
}

const LIST_KEYS = ['items', 'bookings', 'transactions', 'results', 'notifications', 'data'];

/**
 * Normalize a list endpoint payload into an array.
 *
 * List endpoints are not uniform across the API: some return a bare array
 * (`/partner/nearby-bookings`), others return a paginated envelope
 * (`/partner/bookings` -> `{ items, total, page, limit }`), and some wrap the
 * page in a named key (`bookings`, `transactions`, ...). Reading
 * `payload.data ?? []` and then calling `.find`/`.map` on it throws whenever the
 * endpoint happens to use the paginated shape, which blanks out the whole
 * screen. Always normalize through this helper instead.
 */
export function toList<T = any>(payload: unknown, ...keys: string[]): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (!payload || typeof payload !== 'object') return [];

  const record = payload as Record<string, unknown>;
  const candidates = [...keys, ...LIST_KEYS];
  for (const key of candidates) {
    if (Array.isArray(record[key])) return record[key] as T[];
  }
  return [];
}

export function errorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const e = err as AxiosError<ApiEnvelope>;
    return e.response?.data?.message || e.response?.data?.error || fallback;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}

export async function del<T = any>(path: string): Promise<ApiEnvelope<T>> {
  const res = await api.delete<ApiEnvelope<T>>(path);
  return res.data;
}

export interface LocalFile {
  uri: string;
  name: string;
  type: string;
  size?: number;
}

/**
 * Multipart upload for the blob endpoints (fields: `image`, `video`, `photo`).
 * The backend stores the bytes in Postgres and returns a relative `/uploads/...`
 * URL which can then be attached to posts or a profile.
 */
export async function upload<T = any>(path: string, field: string, file: LocalFile): Promise<ApiEnvelope<T>> {
  const form = new FormData();
  form.append(field, { uri: file.uri, name: file.name, type: file.type } as any);
  const res = await api.post<ApiEnvelope<T>>(path, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 90000, // videos can take a while to land in Postgres
  });
  return res.data;
}

/**
 * Resolve a backend `/uploads/...` path into a full URL. Files are served from
 * `/uploads` (outside `/api`), so the API base suffix must be stripped first.
 */
export function mediaUrl(uri?: string | null): string | undefined {
  if (!uri) return undefined;
  if (/^https?:\/\//i.test(uri)) return uri;
  const base = API_URL.replace(/\/api\/?$/, '');
  return `${base}${uri.startsWith('/') ? '' : '/'}${uri}`;
}
