# 0004. Photos are resized in the browser; the Worker has no image library

Status: Accepted

**Decision:** The browser resizes and re-encodes every photo (a 2048 px and a 600 px variant, WebP or JPEG) before upload. The Worker stores and serves the bytes and never decodes an image.

**Why:** Workers have no native image libraries and a tight CPU budget. Resizing on the phone also saves upload time on a slow connection and drops EXIF location data before it leaves the device.

**Consequences:** no server-side thumbnails, rotation, or format conversion; new image variants are made in `lib/images.ts` and uploaded by the client. Cloudflare Images or a WASM codec would be a new decision.
