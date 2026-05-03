/**
 * Pino logger with pretty output in development, JSON in production.
 */

import pino from "pino";
import { env } from "./env.ts";

const isDev = env.NODE_ENV === "development";

export const logger = pino({
  level: env.LOG_LEVEL,
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss",
            ignore: "pid,hostname",
          },
        },
      }
    : {}),
});

/** Get a child logger with module name baked in. */
export function child(module: string) {
  return logger.child({ module });
}
