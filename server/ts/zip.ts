/** Minimal read-only ZIP reader for importing user-supplied archives.
 * Uses only the central directory and the platform's DecompressionStream, so it
 * runs unchanged on Node and Cloudflare Workers, and it inflates only the
 * entries the caller asks for (bounded), which keeps huge archives cheap.
 */
const u16 = (v: DataView, o: number) => v.getUint16(o, true);
const u32 = (v: DataView, o: number) => v.getUint32(o, true);

async function inflate(data: Uint8Array, limit: number): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new Error("A file in the archive is too large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Returns the requested entries keyed by base name; missing ones are absent. */
export async function readZip(
  bytes: Uint8Array,
  wanted: readonly string[],
  limit = 32 * 1024 * 1024,
): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (
    let i = bytes.length - 22;
    i >= Math.max(0, bytes.length - 22 - 65535);
    i--
  )
    if (u32(view, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error("This is not a ZIP file");
  const count = u16(view, eocd + 10);
  let at = u32(view, eocd + 16);
  if (count === 0xffff || at === 0xffffffff)
    throw new Error("ZIP64 archives are not supported");
  const found = new Map<string, Uint8Array>();
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || u32(view, at) !== 0x02014b50)
      throw new Error("The ZIP file is damaged");
    const flags = u16(view, at + 8);
    const method = u16(view, at + 10);
    const size = u32(view, at + 20);
    const nameLength = u16(view, at + 28);
    const next = at + 46 + nameLength + u16(view, at + 30) + u16(view, at + 32);
    const local = u32(view, at + 42);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at = next;
    const base = name.split("/").pop() ?? "";
    if (name.includes("..") || !wanted.includes(base) || found.has(base))
      continue;
    if (flags & 1) throw new Error("Encrypted ZIP files are not supported");
    if (local + 30 > bytes.length || u32(view, local) !== 0x04034b50)
      throw new Error("The ZIP file is damaged");
    const start = local + 30 + u16(view, local + 26) + u16(view, local + 28);
    if (start + size > bytes.length) throw new Error("The ZIP file is damaged");
    const raw = bytes.subarray(start, start + size);
    if (method === 0) {
      if (size > limit) throw new Error("A file in the archive is too large");
      found.set(base, raw);
    } else if (method === 8) found.set(base, await inflate(raw, limit));
    else throw new Error("Unsupported ZIP compression");
  }
  return found;
}
