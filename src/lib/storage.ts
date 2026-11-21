import { randomUUID } from "node:crypto";

export type PutFile = (name: string, bytes: Uint8Array, contentType: string) => Promise<{ url: string }>;

const safeName = (name: string) => name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 100) || "file";

/**
 * Default file store: Vercel Blob. Blobs are private. The path starts with a random id so it
 * cannot be guessed. Only fails (with a clear message) when an upload is attempted.
 */
export const blobPutFile: PutFile = async (name, bytes, contentType) => {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("File storage is not set up. Set BLOB_READ_WRITE_TOKEN in .env.local to upload files, or paste the text instead.");
  }
  const { put } = await import("@vercel/blob");
  const blob = await put(`mpc-documents/${randomUUID()}/${safeName(name)}`, Buffer.from(bytes), {
    access: "private",
    contentType,
    addRandomSuffix: true,
  });
  return { url: blob.url };
};

let testStore: PutFile | undefined;

/** Test only: replace the file store with a fake. */
export function setTestFileStore(fn: PutFile | undefined): void {
  if (process.env.NODE_ENV !== "test") throw new Error("setTestFileStore is only available when NODE_ENV is 'test'");
  testStore = fn;
}

export const putFile: PutFile = (name, bytes, contentType) => (testStore ?? blobPutFile)(name, bytes, contentType);
