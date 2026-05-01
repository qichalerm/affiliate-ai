import { Telegraf } from "telegraf";
import { env, can } from "./env.ts";
import { child } from "./logger.ts";
import { retry, errMsg } from "./retry.ts";

const log = child("telegram");

let _bot: Telegraf | undefined;

function bot(): Telegraf {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN not configured");
  }
  if (!_bot) {
    _bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);
  }
  return _bot;
}

export interface SendOptions {
  parseMode?: "Markdown" | "MarkdownV2" | "HTML";
  disableWebPagePreview?: boolean;
  silent?: boolean;
}

/**
 * Send a private message to the operator (you).
 * Used for alerts, reports, action items.
 */
export async function sendOperator(text: string, opts: SendOptions = {}): Promise<void> {
  if (!can.alertTelegram()) {
    log.debug({ text: text.slice(0, 80) }, "telegram disabled — operator message dropped");
    return;
  }
  if (env.DEBUG_DRY_RUN) {
    log.info({ text: text.slice(0, 200) }, "[dry-run] would send to operator");
    return;
  }
  await retry(
    () =>
      bot().telegram.sendMessage(env.TELEGRAM_OPERATOR_CHAT_ID!, text, {
        parse_mode: opts.parseMode ?? "Markdown",
        link_preview_options: { is_disabled: opts.disableWebPagePreview ?? true },
        disable_notification: opts.silent ?? false,
      }),
    {
      attempts: 3,
      onAttempt: (attempt, err) => log.warn({ attempt, err: errMsg(err) }, "tg retry"),
    },
  );
}

/**
 * Broadcast a deal to the public channel.
 */
export async function sendChannel(text: string, opts: SendOptions = {}): Promise<void> {
  if (!can.broadcastTelegram()) {
    log.debug({ text: text.slice(0, 80) }, "telegram channel disabled — message dropped");
    return;
  }
  if (env.DEBUG_DRY_RUN) {
    log.info({ text: text.slice(0, 200) }, "[dry-run] would broadcast to channel");
    return;
  }
  await retry(() =>
    bot().telegram.sendMessage(env.TELEGRAM_DEAL_CHANNEL_ID!, text, {
      parse_mode: opts.parseMode ?? "Markdown",
      link_preview_options: { is_disabled: opts.disableWebPagePreview ?? false },
      disable_notification: opts.silent ?? false,
    }),
  );
}

export async function sendChannelPhoto(
  photoUrl: string,
  caption: string,
  opts: SendOptions = {},
): Promise<void> {
  if (!can.broadcastTelegram()) return;
  if (env.DEBUG_DRY_RUN) {
    log.info({ photoUrl, caption: caption.slice(0, 200) }, "[dry-run] would send photo");
    return;
  }
  await retry(() =>
    bot().telegram.sendPhoto(env.TELEGRAM_DEAL_CHANNEL_ID!, photoUrl, {
      caption,
      parse_mode: opts.parseMode ?? "Markdown",
    }),
  );
}

/**
 * Lightweight ping — used by test-connections script.
 */
export async function pingBot(): Promise<{ ok: boolean; me?: string; error?: string }> {
  try {
    if (!env.TELEGRAM_BOT_TOKEN) return { ok: false, error: "no token" };
    const me = await bot().telegram.getMe();
    return { ok: true, me: me.username };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
}

/**
 * Markdown-escape user content (Telegram MarkdownV2).
 * Use sparingly — prefer plain Markdown unless you specifically need V2 features.
 */
export function mdEscape(s: string): string {
  return s.replace(/[_*[\]()~`>#+=|{}.!\\-]/g, "\\$&");
}
