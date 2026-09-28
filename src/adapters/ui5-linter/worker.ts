import type { LintResult, UI5LinterOptions } from "@ui5/linter";
import { disableNetwork } from "./offline.js";

disableNetwork();
function reply(message: { ok: boolean; results?: LintResult[] }): Promise<void> {
  return new Promise((resolve) => {
    if (!process.connected || !process.send) {
      resolve();
      return;
    }
    process.send(message, () => resolve());
  });
}
// Only the installed analyzer is imported. Project configs/scripts are never imported.
process.once("message", async (options: UI5LinterOptions) => {
  try {
    const { ui5lint } = await import("@ui5/linter");
    const results = await ui5lint({
      ...options,
      noConfig: true,
      fix: false,
      coverage: false,
      details: false,
    });
    await reply({ ok: true, results });
  } catch {
    await reply({ ok: false });
  } finally {
    if (process.connected) process.disconnect();
  }
});
