const apiBaseUrl = (
  import.meta.env?.VITE_API_BASE_URL || '/api'
).replace(/\/$/, '')

let authExpiryTimer
let authExpired = false

function clearAuthExpiryTimer() {
  if (authExpiryTimer) window.clearTimeout(authExpiryTimer)
  authExpiryTimer = undefined
}

function forceLogout() {
  if (authExpired) return
  authExpired = true
  clearAuthExpiryTimer()
  window.dispatchEvent(new Event('auth:expired'))
}

function scheduleAuthExpiry(response) {
  const expiryHeader = response.headers.get('X-Auth-Expires-At')
  if (expiryHeader === null || expiryHeader.trim() === '') return

  const expiresAt = Number(expiryHeader)
  if (!Number.isFinite(expiresAt)) return

  authExpired = false
  clearAuthExpiryTimer()
  const delay = expiresAt - Date.now()
  if (delay <= 0) {
    forceLogout()
    return
  }
  authExpiryTimer = window.setTimeout(forceLogout, delay)
}

export async function apiRequest(path, options = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  })

  if (path === '/auth/logout') clearAuthExpiryTimer()
  else scheduleAuthExpiry(response)

  if (response.status === 401 && !path.startsWith('/auth/')) {
    forceLogout()
  }

  const contentType = response.headers.get('content-type') || ''
  const data = contentType.includes('application/json')
    ? await response.json()
    : null

  if (!response.ok) {
    const error = new Error(data?.error || 'Request failed')
    error.status = response.status
    error.code = data?.code
    error.resendAt = data?.resendAt
    error.verificationRequired = data?.verificationRequired === true
    const retryAfter = Number(response.headers.get('Retry-After'))
    error.retryAfterSeconds = Number.isFinite(data?.retryAfterSeconds)
      ? data.retryAfterSeconds
      : Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 0
    throw error
  }

  return data
}

export { apiBaseUrl }
