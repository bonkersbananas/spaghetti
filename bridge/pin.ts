/**
 * Trust on first use for the printer's certificate. The printer's TLS certificate is self-signed, so the bridge can't
 * verify it against a certificate authority, and the access code is a password sent to whatever answers on the
 * printer's address. The first time a service (MQTT, FTPS, the camera) is reached, its certificate's SHA-256
 * fingerprint is written to the bridge's state file; after that a different certificate is refused before any
 * credential is sent.
 *
 * Whether the community tools verify against a Bambu printer CA with the serial number as the name is [uncertain],
 * so this doesn't rely on it.
 */
import tls from "node:tls";

export type PinnedService = "mqtt" | "ftps" | "camera";

export interface PinStorage {
  /** Fingerprints by service. */
  certs: Partial<Record<PinnedService, string>>;
  save(): void;
}

export class CertPin {
  private storage: PinStorage;
  private trustNew: boolean;
  private log: (message: string) => void;
  private lastWarned = new Map<string, number>();

  constructor(storage: PinStorage, options: { trustNew?: boolean; log?: (message: string) => void } = {}) {
    this.storage = storage;
    this.trustNew = options.trustNew ?? false;
    this.log = options.log ?? (() => {});
  }

  /** Null when the certificate may be trusted, else why not (already logged, at most every ten minutes). */
  check(service: PinnedService, fingerprint: string): string | null {
    const pinned = this.storage.certs[service];
    if (pinned === fingerprint) return null;
    if (!pinned || this.trustNew) {
      this.storage.certs[service] = fingerprint;
      this.storage.save();
      this.log(
        pinned
          ? `Accepted the printer's new ${service} certificate (${fingerprint}); it replaces ${pinned}.`
          : `Trusting the printer's ${service} certificate on first use (${fingerprint}). A different one will be refused.`,
      );
      return null;
    }
    const why =
      `The printer's ${service} certificate changed: it was ${pinned}, now ${fingerprint}. ` +
      "Refusing to send the access code. If the printer's firmware was updated or it was reset, accept the new one by " +
      `running once with --trust-new-certificate (or BRIDGE_TRUST_NEW_CERTIFICATE=1), or delete "${service}" under "certs" in state.json. ` +
      "If you didn't change anything, something else on the network may be answering as the printer.";
    const now = Date.now();
    if (now - (this.lastWarned.get(service) ?? 0) > 10 * 60_000) {
      this.lastWarned.set(service, now);
      this.log(why);
    }
    return why;
  }
}

/** The fingerprint of the certificate a TLS socket was given, once its handshake is done. */
export const fingerprintOf = (socket: tls.TLSSocket): string => socket.getPeerCertificate().fingerprint256 ?? "";

/**
 * Opens a TLS connection to a service and reads its certificate, sending nothing. Used where another program makes
 * the real connection (ffmpeg for the camera), so the check happens first.
 */
export function probeFingerprint(host: string, port: number, timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, rejectUnauthorized: false, timeout: timeoutMs }, () => {
      const fingerprint = fingerprintOf(socket);
      socket.destroy();
      fingerprint ? resolve(fingerprint) : reject(new Error("The service presented no certificate."));
    });
    socket.on("error", reject);
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("Timed out waiting for the certificate."));
    });
  });
}
