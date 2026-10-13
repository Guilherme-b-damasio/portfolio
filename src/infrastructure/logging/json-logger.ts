import type { LogFields, Logger } from "../../domain/logger.js";

/** Writes one JSON object per line to stdout, the format the cluster's log collector expects. */
export class JsonLogger implements Logger {
  constructor(
    private readonly write: (line: string) => void = (line) => process.stdout.write(line + "\n"),
    private readonly now: () => Date = () => new Date(),
  ) {}

  info(msg: string, fields?: LogFields) {
    this.emit("info", msg, fields);
  }

  error(msg: string, fields?: LogFields) {
    this.emit("error", msg, fields);
  }

  private emit(level: string, msg: string, fields: LogFields = {}) {
    // Fixed keys go last so a field can never overwrite the level, message or timestamp.
    this.write(JSON.stringify({ ...fields, time: this.now().toISOString(), level, msg }));
  }
}
