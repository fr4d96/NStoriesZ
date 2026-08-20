/**
 * heic-decode ships no type declarations of its own. Only the default
 * export (decode the primary image) is used here -- the package's `.all()`
 * multi-image variant is deliberately not declared, since an image
 * sequence is not something this app accepts.
 */
declare module "heic-decode" {
  export default function decode(input: {
    buffer: Buffer | ArrayBuffer | Uint8Array;
  }): Promise<{
    width: number;
    height: number;
    data: Uint8ClampedArray;
  }>;
}
