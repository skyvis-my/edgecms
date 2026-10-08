export function resolveApiBasePath(appOrigin: string | undefined = globalThis.location?.origin) {
  void appOrigin
  return '/api'
}
