/**
 * One frame from the printer's camera, for the attempt's photo. The X1 family streams RTSPS on port 322; whether the
 * X2D does is [uncertain], so a frame that can't be had is skipped quietly. Needs ffmpeg; without it there is simply
 * no photo.
 */
import { spawn } from "node:child_process";

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
}

export function ffmpegCamera(options: CameraOptions): Camera {
  let warned = false;
  return {
    grab() {
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
          if (!warned) options.log?.("No camera frame: ffmpeg isn't installed, so prints get no photo.");
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
