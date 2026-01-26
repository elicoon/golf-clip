// packages/frontend/src/config.ts
/**
 * Application configuration.
 * API URL is configurable via VITE_API_URL environment variable.
 */

const getApiBaseUrl = (): string => {
  // Vite exposes env vars with VITE_ prefix at build time
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL
  }
  // Default to localhost for desktop/development
  return 'http://127.0.0.1:8420'
}

export const config = {
  apiBaseUrl: getApiBaseUrl(),
}

/**
 * Build a full API URL from a path.
 * @param path - API path (e.g., '/api/upload' or 'api/upload')
 * @returns Full URL (e.g., 'http://127.0.0.1:8420/api/upload')
 */
export const apiUrl = (path: string): string => {
  const base = config.apiBaseUrl.replace(/\/$/, '')
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  return `${base}${cleanPath}`
}
