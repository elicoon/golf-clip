/**
 * Type declarations for Essentia.js
 *
 * Essentia.js doesn't provide complete TypeScript definitions for its ES module exports.
 * These declarations cover the modules used in audio-detector.ts.
 */

declare module 'essentia.js/dist/essentia-wasm.es.js' {
  /**
   * WASM module instance (named export, not a factory function)
   * For ES modules, EssentiaWASM is the module object directly
   */
  export const EssentiaWASM: unknown
}

declare module 'essentia.js/dist/essentia.js-core.es.js' {
  /**
   * Essentia class constructor - wraps the WASM module with a high-level API
   */
  export default class Essentia {
    constructor(wasmModule: unknown, isDebug?: boolean)

    // Utility methods
    arrayToVector(inputArray: Float32Array): unknown
    vectorToArray(inputVector: unknown): Float32Array

    // Onset detection
    SuperFluxExtractor(
      signal: unknown,
      combine?: number,
      frameSize?: number,
      hopSize?: number,
      ratioThreshold?: number,
      sampleRate?: number,
      threshold?: number
    ): { onsets: number[] }

    // Spectral analysis
    SpectralCentroidTime(
      array: unknown,
      sampleRate?: number
    ): { centroid: number }

    Flatness(array: unknown): { flatness: number }

    // Filters
    BandPass(
      signal: unknown,
      bandwidth?: number,
      cutoffFrequency?: number,
      sampleRate?: number
    ): { signal: unknown }

    // Energy
    RMS(array: unknown): { rms: number }
  }
}
