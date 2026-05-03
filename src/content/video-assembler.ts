/**
 * Video assembler via FFmpeg (M4 — Sprint 9).
 *
 * Stitches images + voice narration + optional text overlay → MP4.
 * Output is ready for IG Reel / TikTok / Shopee Video / FB Reel.
 *
 * Default format: 1080×1920 vertical, H.264 + AAC, ~30s.
 *
 * Two key inputs:
 *   1. Voice MP3 (from voice-generator.ts) — drives total video length
 *   2. Image URLs (from image-generator.ts) — N images, each shown for
 *      duration / N seconds with subtle ken-burns zoom
 *
 * No external API. Fully testable. Spawns ffmpeg subprocess.
 *
 * Limitations:
 *   - Background music deferred (needs free music library setup)
 *   - Subtitle burn-in deferred (needs Submagic-style word timings)
 *   - For Sprint 9, just images + voice + simple text overlay
 */

import { spawn } from "node:child_process";
import { writeFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { sql } from "drizzle-orm";
import { db, schema } from "../lib/db.ts";
import { child } from "../lib/logger.ts";
import { errMsg } from "../lib/retry.ts";

const log = child("content.video-asm");

const OUTPUT_DIR = "/tmp/affiliate-ai/video";
const TEMP_DIR = "/tmp/affiliate-ai/video/tmp";

export interface VideoAssemblyOptions {
  /** Path to MP3 voice narration (from generateVoice). */
  voiceMp3Path: string;
  /** Image URLs (will be downloaded to temp). At least 1. */
  imageUrls: string[];
  /** Optional text overlay (single caption shown for first 3s). */
  overlayText?: string;
  /** Output file name (no extension). Default: timestamp. */
  fileName?: string;
  /** Output dimensions. Default: 1080×1920 vertical. */
  width?: number;
  height?: number;
  /** Override total video duration (sec). Default: from voice MP3 length, or 15s if unknown. */
  durationSec?: number;
  task?: string;
}

export interface VideoResult {
  filePath: string;
  fileName: string;
  durationMs: number;        // assembly time
  estimatedVideoSec: number;
  width: number;
  height: number;
  fileSizeBytes: number;
  generationRunId: number;
}

/**
 * Probe MP3 duration via ffprobe (returns seconds, or null if unable).
 */
async function probeMp3DurationSec(filePath: string): Promise<number | null> {
  return new Promise((resolve) => {
    const proc = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    let out = "";
    proc.stdout.on("data", (d) => { out += d.toString(); });
    proc.on("close", () => {
      const sec = Number.parseFloat(out.trim());
      resolve(Number.isFinite(sec) && sec > 0 ? sec : null);
    });
    proc.on("error", () => resolve(null));
  });
}

/**
 * Download URL → local file. Returns local path.
 */
async function downloadImage(url: string, destPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(destPath, buffer);
}

/**
 * Spawn ffmpeg + return promise resolved on exit code 0.
 */
function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-500)}`));
    });
    proc.on("error", (err) => reject(err));
  });
}

/**
 * Escape text for ffmpeg drawtext filter.
 */
function ffEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:");
}

export async function assembleVideo(opts: VideoAssemblyOptions): Promise<VideoResult> {
  const start = Date.now();
  const width = opts.width ?? 1080;
  const height = opts.height ?? 1920;
  const fileName = opts.fileName ?? `video_${Date.now()}`;
  const filePath = join(OUTPUT_DIR, `${fileName}.mp4`);

  // Ensure dirs
  if (!existsSync(OUTPUT_DIR)) await mkdir(OUTPUT_DIR, { recursive: true });
  if (!existsSync(TEMP_DIR)) await mkdir(TEMP_DIR, { recursive: true });

  // Probe voice for duration (or fall back)
  const voiceDurSec = opts.durationSec ?? (await probeMp3DurationSec(opts.voiceMp3Path)) ?? 15;
  const totalSec = Math.max(5, Math.ceil(voiceDurSec));
  const perImageSec = totalSec / opts.imageUrls.length;

  // Insert generation_runs row
  const [runRow] = await db
    .insert(schema.generationRuns)
    .values({
      task: opts.task ?? "video_assemble",
      provider: "ffmpeg",
      model: "ffmpeg-6.1",
      success: false,
      metadata: {
        imageCount: opts.imageUrls.length,
        totalSec,
        perImageSec,
        width,
        height,
        hasOverlay: Boolean(opts.overlayText),
      },
    })
    .returning({ id: schema.generationRuns.id });
  const generationRunId = runRow!.id;

  try {
    // 1. Download images to temp
    const localImages: string[] = [];
    for (let i = 0; i < opts.imageUrls.length; i++) {
      const ext = opts.imageUrls[i]!.includes(".png") ? "png" : "jpg";
      const localPath = join(TEMP_DIR, `${fileName}_img${i}.${ext}`);
      await downloadImage(opts.imageUrls[i]!, localPath);
      localImages.push(localPath);
    }

    // 2. Build ffmpeg command
    // Strategy: each image becomes a video segment of perImageSec, then concat.
    // Use single ffmpeg command with input list + complex filter for ken-burns + concat.
    const args: string[] = ["-y"]; // overwrite output

    // Add each image as input with looping
    for (const img of localImages) {
      args.push("-loop", "1", "-t", String(perImageSec), "-i", img);
    }
    // Add voice MP3 as last input
    args.push("-i", opts.voiceMp3Path);

    // Build filter graph:
    // - Each image input: scale to fit, pad to vertical, slight zoom
    // - Concat all video segments
    // - Overlay text on first segment (if provided)
    const filterParts: string[] = [];
    const concatInputs: string[] = [];

    for (let i = 0; i < localImages.length; i++) {
      // scale to cover (no distortion), then crop to target dims
      const baseFilter = `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1`;

      if (i === 0 && opts.overlayText) {
        // Add text overlay on first segment (visible 0-3s)
        const escaped = ffEscape(opts.overlayText);
        filterParts.push(
          `${baseFilter},drawtext=text='${escaped}':fontcolor=white:fontsize=72:box=1:boxcolor=black@0.6:boxborderw=20:x=(w-text_w)/2:y=h-text_h-100:enable='lt(t,3)'[v${i}]`,
        );
      } else {
        filterParts.push(`${baseFilter}[v${i}]`);
      }
      concatInputs.push(`[v${i}]`);
    }

    // Concat
    filterParts.push(`${concatInputs.join("")}concat=n=${localImages.length}:v=1:a=0[outv]`);
    args.push("-filter_complex", filterParts.join(";"));

    // Map outputs: video from filter, audio from voice MP3
    args.push("-map", "[outv]");
    args.push("-map", `${localImages.length}:a`);

    // Encode params
    args.push(
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "23",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "128k",
      "-shortest",  // stop at shortest stream (audio = canonical)
      filePath,
    );

    log.debug({ args: args.slice(-20) }, "ffmpeg args (tail)");
    await runFfmpeg(args);

    const fileStat = await stat(filePath);
    const durationMs = Date.now() - start;

    await db
      .update(schema.generationRuns)
      .set({
        success: true,
        durationMs,
        costUsdMicros: 0, // FFmpeg local — no $ cost
      })
      .where(sql`id = ${generationRunId}`);

    log.info(
      {
        generationRunId,
        fileName,
        totalSec,
        imageCount: opts.imageUrls.length,
        fileSizeBytes: fileStat.size,
        durationMs,
      },
      "video assembled",
    );

    return {
      filePath,
      fileName,
      durationMs,
      estimatedVideoSec: totalSec,
      width,
      height,
      fileSizeBytes: fileStat.size,
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
