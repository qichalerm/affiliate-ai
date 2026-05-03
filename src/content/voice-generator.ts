/**
 * Voice generator via ElevenLabs (M4 — Sprint 8).
 *
 * Thai TTS for video narration. Uses ELEVENLABS_VOICE_ID (set after
 * uploading a 3-5min sample of operator's voice as a Voice Clone).
 *
 * Model: eleven_multilingual_v3 — supports Thai natively, decent prosody.
 *
 * Cost: ~$0.30 per 1K chars on Starter plan ($22/mo = ~70K chars/mo).
 * For 30s scripts (~250 Thai chars), that's ~$0.075 per video voice.
 *
 * DRY-RUN: returns a placeholder MP3 URL pointing to a silent file,
 * keyed by content hash so downstream FFmpeg assembly works.
 */

import { sql } from "drizzle-orm";
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawn } from "node:child_process";
import { db, schema } from "../lib/db.ts";
import { env } from "../lib/env.ts";
import { child } from "../lib/logger.ts";
import { errMsg, retry } from "../lib/retry.ts";

const log = child("content.voice-gen");

const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";

/** Output dir for generated MP3 files. */
const OUTPUT_DIR = "/tmp/affiliate-ai/voice";

export interface GenerateVoiceOptions {
  text: string;
  /** Override voice ID (default: env.ELEVENLABS_VOICE_ID). */
  voiceId?: string;
  /** Output file name (no extension). Default: hash of text. */
  fileName?: string;
  /** Stability 0-1 — lower = more expressive, higher = more consistent. */
  stability?: number;
  /** Similarity 0-1 — how closely to match the cloned voice. */
  similarityBoost?: number;
  /** Speaker style 0-1 — exaggeration. */
  style?: number;
  forceDryRun?: boolean;
  task?: string;
}

export interface VoiceResult {
  filePath: string;        // local MP3 path on disk
  fileName: string;
  durationMs: number;      // generation time, NOT audio length
  costUsd: number;
  estimatedAudioSec: number;  // rough estimate of audio length
  charCount: number;
  dryRun: boolean;
  generationRunId: number;
}

async function hashText(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer).slice(0, 8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Generate Thai voice narration MP3.
 * In dry-run, writes a 1-byte placeholder file (FFmpeg will skip it gracefully).
 */
export async function generateVoice(opts: GenerateVoiceOptions): Promise<VoiceResult> {
  const start = Date.now();
  const charCount = opts.text.length;
  const estimatedAudioSec = Math.ceil(charCount / 12); // ~12 chars/sec for Thai TTS
  const dryRun = opts.forceDryRun || env.DEBUG_DRY_RUN || !env.ELEVENLABS_API_KEY || !env.ELEVENLABS_VOICE_ID;

  // Output path
  const fileName = opts.fileName ?? `voice_${await hashText(opts.text)}`;
  const filePath = join(OUTPUT_DIR, `${fileName}.mp3`);

  // Ensure output dir exists
  if (!existsSync(dirname(filePath))) {
    await mkdir(dirname(filePath), { recursive: true });
  }

  // Insert generation_runs row
  const [runRow] = await db
    .insert(schema.generationRuns)
    .values({
      task: opts.task ?? "voice_gen.narration",
      provider: "elevenlabs",
      model: env.ELEVENLABS_MODEL,
      success: false,
      metadata: { charCount, estimatedAudioSec, voiceId: opts.voiceId ?? env.ELEVENLABS_VOICE_ID, dryRun },
    })
    .returning({ id: schema.generationRuns.id });
  const generationRunId = runRow!.id;

  if (dryRun) {
    // Generate a real silent MP3 of estimated duration so FFmpeg pipeline works.
    await new Promise<void>((resolve, reject) => {
      const proc = spawn("ffmpeg", [
        "-y",
        "-f", "lavfi",
        "-i", `anullsrc=channel_layout=mono:sample_rate=22050`,
        "-t", String(estimatedAudioSec),
        "-c:a", "libmp3lame",
        "-b:a", "32k",
        filePath,
      ], { stdio: "ignore" });
      proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg silent MP3 exit ${code}`)));
      proc.on("error", reject);
    });
    log.info(
      { generationRunId, fileName, charCount, estimatedAudioSec },
      "[DRY-RUN] silent MP3 placeholder written",
    );
    await db
      .update(schema.generationRuns)
      .set({
        success: true,
        durationMs: Date.now() - start,
        costUsdMicros: 0,
      })
      .where(sql`id = ${generationRunId}`);
    return {
      filePath,
      fileName,
      durationMs: Date.now() - start,
      costUsd: 0,
      estimatedAudioSec,
      charCount,
      dryRun: true,
      generationRunId,
    };
  }

  // === Live: ElevenLabs API ===
  try {
    const audio = await retry(
      async () => {
        const voiceId = opts.voiceId ?? env.ELEVENLABS_VOICE_ID!;
        const res = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${voiceId}`, {
          method: "POST",
          headers: {
            "xi-api-key": env.ELEVENLABS_API_KEY!,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
          body: JSON.stringify({
            text: opts.text,
            model_id: env.ELEVENLABS_MODEL,
            voice_settings: {
              stability: opts.stability ?? 0.55,
              similarity_boost: opts.similarityBoost ?? 0.75,
              style: opts.style ?? 0.0,
              use_speaker_boost: true,
            },
          }),
        });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`ElevenLabs ${res.status}: ${body.slice(0, 300)}`);
        }
        return await res.arrayBuffer();
      },
      { attempts: 2, baseDelayMs: 1000 },
    );

    await writeFile(filePath, Buffer.from(audio));

    // Cost: ~$0.30 per 1000 chars (Starter plan)
    const costUsd = (charCount / 1000) * 0.30;

    await db
      .update(schema.generationRuns)
      .set({
        success: true,
        durationMs: Date.now() - start,
        costUsdMicros: Math.round(costUsd * 1_000_000),
      })
      .where(sql`id = ${generationRunId}`);

    log.info(
      { generationRunId, fileName, charCount, costUsd: costUsd.toFixed(6), durationMs: Date.now() - start },
      "voice generated",
    );

    return {
      filePath,
      fileName,
      durationMs: Date.now() - start,
      costUsd,
      estimatedAudioSec,
      charCount,
      dryRun: false,
      generationRunId,
    };
  } catch (err) {
    await db
      .update(schema.generationRuns)
      .set({
        success: false,
        durationMs: Date.now() - start,
        errorMsg: errMsg(err),
      })
      .where(sql`id = ${generationRunId}`);
    throw err;
  }
}
