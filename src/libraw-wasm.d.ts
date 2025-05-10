declare module 'libraw-wasm' {
  interface LibRawOptions {
    // Define options that can be passed to rawProcessor.open()
    halfSize?: boolean;
    useCamera?: boolean;
    outputBps?: number;
    outputcolor?: number;
    noAutoBright?: boolean;
    autoBrightThreshold?: number;
    adjust_maximum_thr?: number;
    user_qual?: number;
  }

  interface Metadata {
    timestamp?: number;
    model?: string;
    make?: string;
    orientation?: number;
    iso?: number;
    shutter?: number;
    aperture?: number;
    focal_length?: number;
    [key: string]: unknown;
  }

  interface DecodedImage {
    data: Uint8Array; // Pixel data
    width: number;
    height: number;
    colors: number; // Number of color components (e.g., 3 for RGB, 4 for RGBA)
    bits: number; // Bits per sample
    rawWidth?: number;
    rawHeight?: number;
    // type?: 'rgb' | 'rgba' | string; // Type might not always be present
    // Add other properties returned by imageData() if known
  }

  class LibRaw {
    constructor();
    open(data: Uint8Array, options?: LibRawOptions): Promise<void>;
    imageData(): Promise<DecodedImage>;
    metadata(fullOutput?: boolean): Promise<Metadata>;
    close(): Promise<void>;
    // Add other methods as per the library's API
  }

  export default LibRaw;
}
