export interface RuntimeVersionCheck {
  supported: boolean;
  deprecated: boolean;
  message?: string;
  warning?: string;
}

export function evaluateRuntimeVersion(version = process.versions.node): RuntimeVersionCheck {
  const parts = version.split(".").map((n) => Number.parseInt(n, 10));
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;

  if (major < 20 || (major === 20 && minor < 11)) {
    return {
      supported: false,
      deprecated: false,
      message: "Kaev requires Node.js 20.11 or newer.\nPlease upgrade to Node.js 22 or 24 LTS.\n",
    };
  }

  if (major === 20) {
    return {
      supported: true,
      deprecated: true,
      warning:
        "Kaev: Node.js 20 support is deprecated and will be removed in a future release; use Node.js 22 or 24 LTS.\n",
    };
  }

  if (major !== 22 && major !== 24) {
    return {
      supported: false,
      deprecated: false,
      message: "This Node.js release is not supported by Kaev.\nPlease use Node.js 22 or 24 LTS.\n",
    };
  }

  return {
    supported: true,
    deprecated: false,
  };
}

export function enforceRuntimeVersion(): void {
  const check = evaluateRuntimeVersion();
  if (!check.supported) {
    process.stderr.write(check.message ?? "Unsupported Node.js version.\n");
    process.exit(2);
  }
}

export function warnDeprecatedRuntimeIfNeeded(options: { quiet?: boolean; format?: string }): void {
  if (options.quiet) return;
  if (options.format && options.format !== "terminal") return;
  const check = evaluateRuntimeVersion();
  if (check.deprecated && check.warning) {
    process.stderr.write(check.warning);
  }
}
