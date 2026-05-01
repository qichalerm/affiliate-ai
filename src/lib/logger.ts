import pino from "pino";
import { env } from "./env.ts";

const isDev = env.NODE_ENV === "development";

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { pid: undefined, hostname: undefined },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss",
            ignore: "pid,hostname",
            messageFormat: "{module} | {msg}",
          },
        },
      }
    : {}),
});

export type Logger = typeof logger;

export function child(module: string, extra: Record<string, unknown> = {}): Logger {
  return logger.child({ module, ...extra });
}
