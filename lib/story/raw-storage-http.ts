import "server-only";
import { request as httpsRequest } from "node:https";
import { URL } from "node:url";

/**
 * Talks to Supabase Storage's REST API directly over `node:https`, bypassing
 * `fetch` (and therefore `undici`) entirely. Two escalating fixes for image
 * upload corruption in production were tried first and both failed under
 * real-world load, confirmed live each time by re-downloading the actually-
 * stored object via plain `curl` (proving genuine write-time corruption, not
 * an artifact of whichever JS client read it back):
 *   1. Sending the body as a Blob instead of a raw Buffer/Uint8Array.
 *   2. Also pinning `fetch` to `undici`'s directly instead of the implicit
 *      `globalThis.fetch` (which Next.js patches for its Data Cache).
 * Both still corrupted binary bytes intermittently -- the corruption
 * pattern is always specific bytes replaced by the 3-byte UTF-8
 * "replacement character" sequence (EF BF BD), the unmistakable signature
 * of some layer decoding the body as a UTF-8 string and re-encoding it.
 * Fix #2's `import { fetch } from "undici"` still routes through undici's
 * *global* dispatcher unless a request explicitly supplies its own, and
 * Vercel's runtime instrumentation (OpenTelemetry auto-instrumentation, or
 * similar) very plausibly patches that global dispatcher -- which would
 * explain corruption surviving even a from-package `undici` import. Rather
 * than chase further fetch/undici-layer patching, this drops down to
 * `node:https` directly: a completely separate code path with no relation
 * to fetch/undici at all, so nothing that patches either can touch it.
 */

export type RawStorageAuth = { apikey: string; bearerToken: string };

function encodeStoragePath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function objectUrl(supabaseUrl: string, bucket: string, path: string): URL {
  return new URL(
    `${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeStoragePath(path)}`,
  );
}

/**
 * Copies `bytes` into a plain, V8-owned Buffer before it is handed to the
 * HTTP layer. This is the actual fix for the long-running upload-corruption
 * bug that three previous attempts (Blob body, undici's fetch, then raw
 * node:https) all failed to solve -- each of those swapped the HTTP *client*
 * while leaving the thing that actually mattered untouched.
 *
 * Diagnosed against real production data (2026-08-26) by comparing the three
 * call sites that share this exact function:
 *   - route handler, original upload -- Buffer.from(await file.arrayBuffer())
 *     -> V8-owned -> verified byte-perfect in storage
 *   - copyStoryMediaToPublic        -- Buffer.concat(node:https chunks)
 *     -> V8-owned -> verified byte-perfect in storage (same service-role
 *        auth AND same x-upsert:true as the failing call, which rules out
 *        auth and upsert as the variable)
 *   - processStoryMedia, derivative -- sharp(...).toBuffer()
 *     -> libvips-allocated external memory -> CORRUPTED
 * A stored derivative was re-downloaded with plain `curl` and contained
 * 107,289 EF BF BD sequences (every byte >0x7F replaced by the UTF-8
 * replacement character); the original of the same upload, in the same
 * request, was a flawless 5712x4284 iPhone JPEG. Uploading the same bytes
 * to the same bucket from a workstation round-tripped perfectly under both
 * upsert modes, so Supabase Storage itself is not the corrupting layer.
 *
 * sharp's toBuffer() returns a Buffer whose backing store is memory libvips
 * allocated and handed to Node through N-API -- a JS `Buffer`, but not one
 * backed by an ordinary V8 ArrayBuffer. Something in Vercel's runtime
 * mishandles that when serialising an outbound request body, decoding it as
 * UTF-8 and re-encoding it (Content-Length is recomputed to the expanded
 * length, so the request is genuinely rebuilt rather than truncated).
 *
 * The copy is unconditional and cheap relative to what follows it: one
 * memcpy of at most MAX_UPLOAD_BYTES against a network upload measured at
 * ~8.3s for 5.4 MB. Applying it here rather than at the sharp call sites
 * means every present and future caller is covered, whatever its buffer's
 * provenance.
 */
function toTransportBuffer(bytes: Buffer): Buffer {
  const copy = Buffer.allocUnsafe(bytes.byteLength);
  bytes.copy(copy);
  return copy;
}

export async function rawStorageUpload(
  supabaseUrl: string,
  auth: RawStorageAuth,
  bucket: string,
  path: string,
  bytes: Buffer,
  contentType: string,
  upsert: boolean,
): Promise<void> {
  const url = objectUrl(supabaseUrl, bucket, path);
  const body = toTransportBuffer(bytes);
  await new Promise<void>((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.bearerToken}`,
          apikey: auth.apikey,
          "Content-Type": contentType,
          "Content-Length": body.byteLength,
          "x-upsert": String(upsert),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) {
            resolve();
            return;
          }
          reject(
            new Error(
              `Storage upload failed (${status}) for ${bucket}/${path}: ${Buffer.concat(chunks).toString("utf8")}`,
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

export async function rawStorageDownload(
  supabaseUrl: string,
  auth: RawStorageAuth,
  bucket: string,
  path: string,
): Promise<Buffer> {
  const url = objectUrl(supabaseUrl, bucket, path);
  return new Promise<Buffer>((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${auth.bearerToken}`,
          apikey: auth.apikey,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          const body = Buffer.concat(chunks);
          if (status >= 200 && status < 300) {
            resolve(body);
            return;
          }
          reject(
            new Error(
              `Storage download failed (${status}) for ${bucket}/${path}: ${body.toString("utf8")}`,
            ),
          );
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}
