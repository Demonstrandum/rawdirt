declare module 'libraw-wasm' {
  interface LibRawOptions {
    // Define any options that can be passed to rawProcessor.open() if known
    // e.g., halfSize?: boolean;
  }

  interface DecodedImage {
    data: Uint8Array; // Pixel data
    width: number;
    height: number;
    colors: number; // Number of color components (e.g., 3 for RGB, 4 for RGBA)
    bits: number; // Bits per sample
    // type?: 'rgb' | 'rgba' | string; // Type might not always be present
    // Add other properties returned by imageData() if known
  }

  class LibRaw {
    constructor();
    open(data: Uint8Array, options?: LibRawOptions): Promise<void>;
    imageData(): Promise<DecodedImage>;
    metadata?(fullOutput?: boolean): Promise<any>; // Assuming a metadata method might exist
    close?(): Promise<void>; // Assuming a close/dispose method might exist
    // Add other methods as per the library's API
  }

  export default LibRaw;
}
