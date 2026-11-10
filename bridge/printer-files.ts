/**
 * The printer's SD card over FTPS (implicit TLS on 990, user `bblp`, the access code). Read-only by construction:
 * the only things this module can do are list a folder and download a file. There is no upload, delete or rename
 * here, and nothing else in the bridge talks FTP.
 */
import { Writable } from "node:stream";
import { Client } from "basic-ftp";

export interface PrinterFiles {
  /** The first file with one of these names, looking in the places Bambu keeps prints. */
  find(names: readonly string[]): Promise<{ path: string; size: number } | null>;
  download(path: string): Promise<Uint8Array>;
}

/** Where a sliced print lands on the SD card. [uncertain] for the X2D. */
export const SEARCH_DIRS = ["/", "/cache", "/model"] as const;

export interface FtpOptions {
  host: string;
  accessCode: string;
  port?: number;
}

export function ftpFiles(options: FtpOptions): PrinterFiles {
  async function connect(): Promise<Client> {
    const client = new Client(30_000);
    await client.access({
      host: options.host,
      port: options.port ?? 990,
      user: "bblp",
      password: options.accessCode,
      secure: "implicit",
      // The printer's certificate is self-signed.
      secureOptions: { rejectUnauthorized: false },
    });
    return client;
  }
  return {
    async find(names) {
      const client = await connect();
      try {
        const wanted = names.map((name) => name.toLowerCase());
        for (const dir of SEARCH_DIRS) {
          const listing = await client.list(dir).catch(() => []);
          const hit = listing.find((entry) => entry.isFile && wanted.includes(entry.name.toLowerCase()));
          if (hit) return { path: `${dir === "/" ? "" : dir}/${hit.name}`, size: hit.size };
        }
        return null;
      } finally {
        client.close();
      }
    },
    async download(path) {
      const client = await connect();
      try {
        const chunks: Buffer[] = [];
        await client.downloadTo(
          new Writable({
            write(chunk: Buffer, _encoding, done) {
              chunks.push(chunk);
              done();
            },
          }),
          path,
        );
        return new Uint8Array(Buffer.concat(chunks));
      } finally {
        client.close();
      }
    },
  };
}
