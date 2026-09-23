export class ZetvikError extends Error {
  constructor(
    public readonly code: "filesystem" | "configuration" | "output" | "internal",
    message: string,
  ) {
    super(message);
    this.name = "ZetvikError";
  }
}
export const EXIT = { success: 0, threshold: 1, failure: 2 } as const;
export const VERSION = "0.1.0";
