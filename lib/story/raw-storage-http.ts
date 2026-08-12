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
  await new Promise<void>((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.bearerToken}`,
          apikey: auth.apikey,
          "Content-Type": contentType,
          "Content-Length": bytes.byteLength,
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
    req.write(bytes);
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
