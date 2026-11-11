/** A QR code as one SVG path, made when asked for: the renderer is loaded then, not with the app. */
export async function qrPath(value: string): Promise<{ size: number; path: string }> {
  const { default: qrcode } = await import("qrcode-generator");
  const code = qrcode(0, "M");
  code.addData(value);
  code.make();
  const size = code.getModuleCount();
  let path = "";
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) if (code.isDark(row, col)) path += `M${col} ${row}h1v1h-1z`;
  }
  return { size, path };
}
