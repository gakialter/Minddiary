/// <reference types="vite/client" />

/** Build-time constant injected by Vite (see vite.config.ts) */
declare const __APP_VERSION__: string

/** Module without type declarations */
declare module 'dom-to-image-more' {
  const domToImage: {
    toBlob: (node: HTMLElement, options?: Record<string, unknown>) => Promise<Blob>
    toPng: (node: HTMLElement, options?: Record<string, unknown>) => Promise<string>
    toSvg: (node: HTMLElement, options?: Record<string, unknown>) => Promise<string>
    toJpeg: (node: HTMLElement, options?: Record<string, unknown>) => Promise<string>
    toPixelData: (node: HTMLElement, options?: Record<string, unknown>) => Promise<Uint8ClampedArray>
  }
  export default domToImage
}
