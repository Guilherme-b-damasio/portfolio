export type LogFields = Record<string, unknown>;

/** Structured logging: one event per call, with machine-readable fields. */
export interface Logger {
  info(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}
