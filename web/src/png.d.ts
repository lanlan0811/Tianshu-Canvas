/** esbuild 的 `dataurl` loader 把 PNG 内联成 data: URI（见 scripts/build.mjs）。 */
declare module '*.png' {
  const dataUri: string
  export default dataUri
}
