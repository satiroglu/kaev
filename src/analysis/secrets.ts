/** Names are one signal, never sufficient evidence of a hardcoded credential. */
export function secretName(name: string): boolean {
  return /^(?:accessToken|refreshToken|idToken|token|password|passwd|secret|clientSecret|apiKey|authorization|cookie|authResponse|privateKey|connectionString)$/i.test(
    name.replace(/[_-]/g, ""),
  );
}

export function credentialPattern(value: string): boolean {
  return (
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(value) ||
    /^Bearer\s+[A-Za-z0-9._~+/-]{20,}/.test(value) ||
    /^(?:sk_live_|sk-proj-|ghp_|github_pat_)[A-Za-z0-9_-]{16,}$/.test(value) ||
    /^AKIA[0-9A-Z]{16}$/.test(value)
  );
}

export function plausibleSecret(value: string): boolean {
  return (
    value.length >= 12 &&
    !/^(?:\{.*\}|\$\{.*\}|<.*>|your[-_ ]|example|placeholder|changeme|test|dummy)/i.test(value) &&
    new Set(value).size >= 8 &&
    /[a-z]/i.test(value) &&
    /[0-9+/=_-]/.test(value)
  );
}
