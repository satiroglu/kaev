import type { UI5LinterOptions } from "@ui5/linter";
import { disableNetwork } from "./offline.js";

disableNetwork();
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
    process.send?.({ ok: true, results });
  } catch {
    process.send?.({ ok: false });
  } finally {
    process.disconnect();
  }
});
