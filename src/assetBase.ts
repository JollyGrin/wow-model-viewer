/**
 * Configurable asset base URL and auth for remote CDN loading.
 * Default: '' (relative, local assets, no auth).
 */
let _base = '';
let _authCookie = '';

export function setAssetBase(url: string) {
  _base = url.replace(/\/+$/, '');
}

export function setAssetAuth(cookie: string) {
  _authCookie = cookie;
}

export function assetUrl(path: string): string {
  return _base + path;
}

/** Fetch options to include Chronicle auth when configured. */
export function assetFetchOpts(): RequestInit | undefined {
  if (!_authCookie) return undefined;
  return {
    credentials: 'include' as RequestCredentials,
    headers: { 'Cookie': `chronicle_auth_session=${_authCookie}` },
  };
}
