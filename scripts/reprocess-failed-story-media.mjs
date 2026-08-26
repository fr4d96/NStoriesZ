#!/usr/bin/env node
// One-off repair for story media stuck in `failed`.
//
// Why this exists: on 2026-08-23 every processed derivative was written to
// Supabase Storage corrupted -- each byte >0x7F replaced by the 3-byte UTF-8
// replacement sequence (EF BF BD) -- so `verifyUploadedBytes` correctly
// rejected them and the media were marked `failed` permanently. The images
// therefore never load. The root cause is fixed in
// lib/story/raw-storage-http.ts (see toTransportBuffer), but that fix only
// helps NEW uploads: nothing re-drives an already-failed row.
//
// The originals are intact -- verified by re-downloading one and decoding a
// flawless 5712x4284 iPhone JPEG -- so each failed media can simply be
// processed again from its original. record_processed_story_media accepts
// `uploaded` or `failed` (supabase/migrations/
// 20260804090200_story_media_processing_functions.sql), so this repair is
// explicitly supported by the state machine rather than working around it.
//
// Runs from a workstation deliberately: local uploads were confirmed
// byte-clean against this same project today, so this does not depend on
// the Vercel deploy having landed first.
//
// This mirrors processStoryMedia() in lib/story/image-pipeline.ts. It is a
// deliberate, temporary duplicate rather than an import because the pipeline
// is TypeScript behind `server-only` and `@/` path aliases, and the repo has
// no TS script runner. Keep the two in step for as long as this file exists;
// the content-addressed path and the strip/resize settings in particular
// MUST match, or the RPC will reject the recorded path.
//
// Usage (dry run by default -- prints what it would do, writes nothing):
//   node --env-file=.env.local scripts/reprocess-failed-story-media.mjs
//   node --env-file=.env.local scripts/reprocess-failed-story-media.mjs --apply

import { createHash } from "node:crypto";
import { request as httpsRequest } from "node:https";
import sharp from "sharp";

const MAX_INPUT_PIXELS = 50_000_000;
const MAX_PROCESSED_DIMENSION = 2000;
const MAX_PROCESSED_BYTES = 8 * 1024 * 1024;
const PRIVATE_BUCKET = "story-images-private";
// Mirrors lib/story/image-pipeline.ts's JPEG_QUALITY_STEPS.
const JPEG_QUALITY_STEPS = [85, 75, 65, 55, 45];

const APPLY = process.argv.includes("--apply");
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Run with: node --env-file=.env.local scripts/reprocess-failed-story-media.mjs",
  );
  process.exit(1);
}

const sha256Hex = (buf) => createHash("sha256").update(buf).digest("hex");

function sniff(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function storageUrl(bucket, path) {
  const encoded = path
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");
  return new URL(
    `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(bucket)}/${encoded}`,
  );
}

function storageDownload(bucket, path) {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      storageUrl(bucket, path),
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${SERVICE_KEY}`,
          apikey: SERVICE_KEY,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks);
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(body);
          else
            reject(
              new Error(`download ${res.statusCode}: ${body.toString("utf8")}`),
            );
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function storageUpload(bucket, path, bytes, contentType) {
  // Same defensive copy as lib/story/raw-storage-http.ts#toTransportBuffer.
  const body = Buffer.allocUnsafe(bytes.byteLength);
  bytes.copy(body);
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      storageUrl(bucket, path),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SERVICE_KEY}`,
          apikey: SERVICE_KEY,
          "Content-Type": contentType,
          "Content-Length": body.byteLength,
          "x-upsert": "true",
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve();
          else
            reject(
              new Error(
                `upload ${res.statusCode}: ${Buffer.concat(chunks).toString("utf8")}`,
              ),
            );
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function rpc(name, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${name} failed: ${await res.text()}`);
}

async function listFailed() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/story_media` +
      `?processing_state=eq.failed&deleted_at=is.null` +
      `&select=id,story_id,private_storage_path&order=created_at.asc`,
    {
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY },
    },
  );
  if (!res.ok) throw new Error(`list failed: ${await res.text()}`);
  return res.json();
}

async function reprocess(media) {
  const original = await storageDownload(
    PRIVATE_BUCKET,
    media.private_storage_path,
  );
  const sniffed = sniff(original);
  if (!sniffed) throw new Error("original is not a JPEG/PNG/WebP");

  const meta = await sharp(original, {
    limitInputPixels: MAX_INPUT_PIXELS,
    pages: -1,
  }).metadata();
  if ((meta.pages ?? 1) > 1) throw new Error("animated images not supported");
  if (!meta.width || !meta.height) throw new Error("no dimensions");

  const processedMime = sniffed === "image/png" ? "image/png" : "image/jpeg";
  const resized = sharp(original, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize({
      width: MAX_PROCESSED_DIMENSION,
      height: MAX_PROCESSED_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    });

  let processed, info;
  if (processedMime === "image/png") {
    ({ data: processed, info } = await resized
      .png()
      .toBuffer({ resolveWithObject: true }));
  } else {
    for (const quality of JPEG_QUALITY_STEPS) {
      ({ data: processed, info } = await resized
        .clone()
        .jpeg({
          quality,
          mozjpeg: true,
          progressive: true,
          chromaSubsampling: "4:2:0",
        })
        .toBuffer({ resolveWithObject: true }));
      if (processed.byteLength <= MAX_PROCESSED_BYTES) break;
    }
  }
  if (processed.byteLength > MAX_PROCESSED_BYTES) {
    throw new Error("processed output exceeds the size limit");
  }

  const hash = sha256Hex(processed);
  const ext = processedMime === "image/png" ? "png" : "jpg";
  const stagingPath = `${media.story_id}/${media.id}/processed-${hash}.${ext}`;

  if (!APPLY) {
    return `DRY RUN would write ${processed.byteLength}B -> ${stagingPath}`;
  }

  await storageUpload(PRIVATE_BUCKET, stagingPath, processed, processedMime);

  // Never trust the 200: re-read and compare, same as the pipeline does.
  const stored = await storageDownload(PRIVATE_BUCKET, stagingPath);
  if (sha256Hex(stored) !== hash) {
    throw new Error("byte verification failed - stored content is corrupt");
  }

  await rpc("record_processed_story_media", {
    p_media_id: media.id,
    p_processed_private_storage_path: stagingPath,
    p_source_mime_type: sniffed,
    p_source_width: meta.width,
    p_source_height: meta.height,
    p_processed_mime_type: processedMime,
    p_processed_file_size_bytes: processed.byteLength,
    p_processed_width: info.width,
    p_processed_height: info.height,
    p_sha256: hash,
  });
  return `repaired -> ${info.width}x${info.height}, ${processed.byteLength}B`;
}

const failed = await listFailed();
console.log(
  `${failed.length} media in 'failed' state${APPLY ? "" : "  (DRY RUN - pass --apply to write)"}\n`,
);

let ok = 0;
let bad = 0;
for (const media of failed) {
  try {
    console.log(`  ${media.id}  ${await reprocess(media)}`);
    ok++;
  } catch (err) {
    console.error(`  ${media.id}  FAILED: ${err.message}`);
    bad++;
  }
}
console.log(`\ndone: ${ok} succeeded, ${bad} failed`);
process.exit(bad > 0 ? 1 : 0);
