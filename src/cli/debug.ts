import { credentialPattern, plausibleSecret } from "../analysis/secrets.js";

export function sanitizeDebugError(error: unknown, root?: string): string {
  let text = error instanceof Error ? error.stack || error.message : String(error);

  // Redact project root path to avoid exposing absolute filesystem locations
  if (root) {
    text = text.replaceAll(root, "<project-root>");
  }

  // Redact sensitive secrets and bearer/key formats
  text = text.replace(/([A-Za-z0-9_.~+/-]{16,})/g, (token) => {
    if (credentialPattern(token) || plausibleSecret(token)) {
      return "[REDACTED]";
    }
    return token;
  });

  // Remove bidi overrides
  text = text.replace(/[\u202A-\u202E\u2066-\u2069]/g, "");

  // Remove ASCII control characters except \t (9), \n (10), and \r (13)
  let clean = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (
      (code >= 0 && code <= 8) ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31) ||
      code === 127
    ) {
      continue;
    }
    clean += text[i];
  }

  return clean;
}
