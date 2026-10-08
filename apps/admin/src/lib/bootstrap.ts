import { resolveApiBasePath } from './api-base-path'

export type BootstrapStatus = {
  needsOnboarding: boolean
  userCount: number
}

const DEFAULT_BOOTSTRAP_STATUS: BootstrapStatus = {
  needsOnboarding: true,
  userCount: 0,
}

export async function getBootstrapStatus(
  fetchImpl: typeof fetch = fetch
): Promise<BootstrapStatus> {
  try {
    const response = await fetchImpl(`${resolveApiBasePath()}/bootstrap/status`, {
      method: 'GET',
      credentials: 'include',
    })

    if (!response.ok) {
      return DEFAULT_BOOTSTRAP_STATUS
    }

    const payload = (await response.json()) as Partial<BootstrapStatus>
    const userCount =
      typeof payload.userCount === 'number' && Number.isFinite(payload.userCount)
        ? payload.userCount
        : 0
    const needsOnboarding =
      typeof payload.needsOnboarding === 'boolean' ? payload.needsOnboarding : userCount === 0

    return { needsOnboarding, userCount }
  } catch {
    return DEFAULT_BOOTSTRAP_STATUS
  }
}
