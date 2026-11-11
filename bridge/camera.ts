/**
 * One frame from the printer's camera, for the attempt's photo. The X1 family streams RTSPS on port 322; whether the
 * X2D does is [uncertain], so a frame that can't be had is skipped quietly. Needs ffmpeg; without it there is simply
 * no photo.
 */
import { spawn } from "node:child_process";
import tls from "node:tls";
import { type CertPin, fingerprintOf, probeFingerprint } from "./pin.ts";

export interface Camera {
  /** A JPEG, or null when there is no frame to be had. */
  grab(): Promise<Uint8Array | null>;
}

export interface CameraOptions {
  host: string;
  accessCode: string;
  /** Where ffmpeg is; "ffmpeg" finds it on the PATH. */
  ffmpeg?: string;
  /** Replaces the stream address, for a camera that is somewhere else. */
  url?: string;
  timeoutMs?: number;
  log?: (message: string) => void;
  /** Checks the stream's certificate before ffmpeg is given the access code. */
  pin?: CertPin;
}

export function ffmpegCamera(options: CameraOptions): Camera {
  let warned = false;
  return {
    async grab() {
      // ffmpeg can't pin a fingerprint, so the certificate is read and checked first (a separate handshake that
      // sends nothing); a service that answers differently the second time isn't caught. Documented in docs/bridge.md.
      if (options.pin && !options.url) {
        const seen = await probeFingerprint(options.host, 322).catch(() => null);
        if (!seen || options.pin.check("camera", seen)) return null;
      }
      const url =
        options.url ?? `rtsps://bblp:${encodeURIComponent(options.accessCode)}@${options.host}:322/streaming/live/1`;
      return new Promise((resolve) => {
        const chunks: Buffer[] = [];
        let settled = false;
        const finish = (frame: Uint8Array | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          child.kill("SIGKILL");
          resolve(frame);
        };
        const child = spawn(
          options.ffmpeg ?? "ffmpeg",
          [
            "-loglevel",
            "error",
            "-rtsp_transport",
            "tcp",
            "-tls_verify",
            "0",
            "-i",
            url,
            "-frames:v",
            "1",
            "-q:v",
            "3",
            "-f",
            "image2pipe",
            "-vcodec",
            "mjpeg",
            "pipe:1",
          ],
          { stdio: ["ignore", "pipe", "ignore"] },
        );
        const timer = setTimeout(() => finish(null), options.timeoutMs ?? 20_000);
        child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
        child.on("error", () => {
          if (!warned) options.log?.("ffmpeg isn't installed, so the RTSPS camera stream can't be read.");
          warned = true;
          finish(null);
        });
        child.on("close", () => {
          const frame = Buffer.concat(chunks);
          finish(frame.length > 1000 && frame[0] === 0xff && frame[1] === 0xd8 ? new Uint8Array(frame) : null);
        });
      });
    },
  };
}

/**
 * A frame from the printer's own picture stream, which needs no ffmpeg: the P1 and A1 printers serve JPEG frames
 * over TLS on port 6000 (the first message, 80 bytes, carries the user `bblp` and the access code; then each frame
 * comes with a 16-byte header that starts with its size). Whether the X2D serves this too is [uncertain]: if the
 * port is closed there is simply no frame. The certificate is pinned before the access code is sent.
 */
export function jpegStreamCamera(options: Omit<CameraOptions, "ffmpeg" | "url"> & { port?: number }): Camera {
  return {
    grab() {
      return new Promise((resolve) => {
        let settled = false;
        let buffer = Buffer.alloc(0);
        const finish = (frame: Uint8Array | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          socket.destroy();
          resolve(frame);
        };
        const socket = tls.connect(
          { host: options.host, port: options.port ?? 6000, rejectUnauthorized: false },
          () => {
            if (options.pin?.check("chamber", fingerprintOf(socket))) return finish(null);
            socket.write(authPacket(options.accessCode));
          },
        );
        const timer = setTimeout(() => finish(null), options.timeoutMs ?? 15_000);
        socket.on("error", () => finish(null));
        socket.on("close", () => finish(null));
        socket.on("data", (chunk: Buffer) => {
          buffer = Buffer.concat([buffer, chunk]);
          if (buffer.length < 16) return;
          const size = buffer.readUInt32LE(0);
          if (size > 8_000_000) return finish(null);
          if (buffer.length < 16 + size) return;
          const frame = buffer.subarray(16, 16 + size);
          finish(frame.length > 1000 && frame[0] === 0xff && frame[1] === 0xd8 ? new Uint8Array(frame) : null);
        });
      });
    },
  };
}

/** The 80-byte login of the picture stream: four little-endian words, then the user and the code, 32 bytes each. */
export function authPacket(accessCode: string): Buffer {
  const packet = Buffer.alloc(80);
  packet.writeUInt32LE(0x40, 0);
  packet.writeUInt32LE(0x3000, 4);
  packet.write("bblp", 16, 32, "ascii");
  packet.write(accessCode, 48, 32, "ascii");
  return packet;
}

/** Tries each camera in turn; the first frame wins. */
export function firstFrame(...cameras: Camera[]): Camera {
  return {
    async grab() {
      for (const camera of cameras) {
        const frame = await camera.grab().catch(() => null);
        if (frame) return frame;
      }
      return null;
    },
  };
}
