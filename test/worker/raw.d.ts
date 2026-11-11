/** Test fixtures read as text (Vite's ?raw). */
declare module "*.html?raw" {
  const html: string;
  export default html;
}
