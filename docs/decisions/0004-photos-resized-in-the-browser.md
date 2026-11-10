# 0004. Photos are resized in the browser; the Worker has no image library

Status: Accepted

**Decision:** The browser resizes and re-encodes every photo (a 2048 px and a 600 px variant, WebP or JPEG) before upload. The Worker stores and serves the bytes and never decodes an image.

**Why:** Workers have no native image libraries and a tight CPU budget. Resizing on the phone also saves upload time on a slow connection and drops EXIF location data before it leaves the device.

**Photos that arrive without a browser** (an agent's capture through MCP, later the printer bridge's camera frames) are stored as they came, at full size as their own thumbnail, and flagged `needs_resize` with a placeholder colour. The next signed-in browser that sees one resizes it in idle time with the same pipeline (`lib/photo-resize.ts`) and uploads the real variants over the originals, which clears the flag. The Worker still never decodes an image: it reads only a JPEG's or WebP's size from its header.

**Consequences:** no server-side thumbnails, rotation, or format conversion; new image variants are made in `lib/images.ts` and uploaded by the client. Cloudflare Images or a WASM codec would be a new decision.
