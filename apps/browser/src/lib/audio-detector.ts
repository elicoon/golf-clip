/**
 * Audio strike detection using Essentia.js
 *
 * Detects golf ball strikes in audio using onset detection and spectral analysis.
 * Essentia.js is a WebAssembly port of the Essentia audio analysis library.
 */

// Essentia types (library doesn't have proper TS types for all exports)
interface EssentiaModule {
  arrayToVector(array: Float32Array): unknown
  vectorToArray(vector: unknown): Float32Array
  SuperFluxExtractor(
    signal: unknown,
    combine?: number,
    frameSize?: number,
    hopSize?: number,
    ratioThreshold?: number,
    sampleRate?: number,
    threshold?: number
  ): { onsets: number[] }
  SpectralCentroidTime(array: unknown, sampleRate?: number): { centroid: number }
  Flatness(array: unknown): { flatness: number }
  BandPass(
    signal: unknown,
    bandwidth?: number,
    cutoffFrequency?: number,
    sampleRate?: number
  ): { signal: unknown }
  RMS(array: unknown): { rms: number }
}

let essentia: EssentiaModule | null = null
let loaded = false

export interface StrikeDetection {
  timestamp: number
  confidence: number
  spectralCentroid: number
  spectralFlatness: number
  onsetStrength: number
}

export interface DetectionConfig {
  frequencyLow: number       // Hz - lower bound of bandpass
  frequencyHigh: number      // Hz - upper bound of bandpass
  minStrikeInterval: number  // Seconds between strikes
  sensitivity: number        // 0-1, higher = more detections
}

export const DEFAULT_CONFIG: DetectionConfig = {
  frequencyLow: 1000,
  frequencyHigh: 8000,
  minStrikeInterval: 0.025, // 25ms minimum between strikes
  sensitivity: 0.5,
}

/**
 * Load Essentia WebAssembly module
 * Must be called before using detectStrikes()
 */
export async function loadEssentia(): Promise<void> {
  if (loaded) return

  // Dynamic import of Essentia.js modules
  // Using ES modules for browser compatibility
  const [{ default: EssentiaWASM }, { default: Essentia }] = await Promise.all([
    import('essentia.js/dist/essentia-wasm.es.js'),
    import('essentia.js/dist/essentia.js-core.es.js'),
  ])

  // Initialize WASM module
  const wasmModule = await EssentiaWASM()
  essentia = new Essentia(wasmModule) as EssentiaModule

  loaded = true
}

/**
 * Check if Essentia is loaded and ready
 */
export function isEssentiaLoaded(): boolean {
  return loaded
}

/**
 * Detect golf ball strikes in audio data
 *
 * Uses SuperFluxExtractor for onset detection (optimized for percussive sounds)
 * and spectral analysis to filter for strike-like sounds.
 *
 * @param audioData - Float32Array of audio samples (-1.0 to 1.0)
 * @param sampleRate - Sample rate of the audio (typically 22050 or 44100 Hz)
 * @param config - Optional detection configuration
 * @returns Array of detected strikes with timestamps and confidence scores
 */
export async function detectStrikes(
  audioData: Float32Array,
  sampleRate: number,
  config: Partial<DetectionConfig> = {}
): Promise<StrikeDetection[]> {
  // Validation
  if (audioData.length === 0) {
    throw new Error('Audio data cannot be empty')
  }
  if (sampleRate <= 0) {
    throw new Error('Sample rate must be positive')
  }
  if (!essentia || !loaded) {
    throw new Error('Essentia not loaded. Call loadEssentia() first.')
  }

  const cfg = { ...DEFAULT_CONFIG, ...config }

  // Convert to Essentia vector
  const audioVector = essentia.arrayToVector(audioData)

  // Apply bandpass filter to isolate strike frequencies
  // Golf ball strikes have significant energy in 1000-8000 Hz range
  const bandwidth = cfg.frequencyHigh - cfg.frequencyLow
  const centerFrequency = (cfg.frequencyLow + cfg.frequencyHigh) / 2
  const filtered = essentia.BandPass(
    audioVector,
    bandwidth,
    centerFrequency,
    sampleRate
  )

  // Use SuperFluxExtractor for onset detection
  // This algorithm is optimized for percussive transients
  const frameSize = 2048
  const hopSize = 256

  // Adjust threshold based on sensitivity (lower threshold = more detections)
  const threshold = 0.1 - cfg.sensitivity * 0.08 // Range: 0.02 to 0.10

  const onsetResult = essentia.SuperFluxExtractor(
    filtered.signal,
    20,            // combine: 20ms double onset threshold
    frameSize,
    hopSize,
    16,            // ratioThreshold
    sampleRate,
    threshold
  )

  const onsetTimes = onsetResult.onsets || []

  // Filter by minimum interval and calculate confidence for each onset
  const strikes: StrikeDetection[] = []
  let lastOnsetTime = -Infinity

  for (const onsetTime of onsetTimes) {
    // Enforce minimum interval between strikes
    if (onsetTime - lastOnsetTime < cfg.minStrikeInterval) {
      continue
    }

    // Extract window around onset for spectral analysis
    const windowSamples = Math.floor(frameSize / 2)
    const onsetSample = Math.floor(onsetTime * sampleRate)
    const windowStart = Math.max(0, onsetSample - windowSamples)
    const windowEnd = Math.min(audioData.length, onsetSample + windowSamples)

    if (windowEnd - windowStart < 100) {
      continue // Skip if window too small
    }

    const window = audioData.slice(windowStart, windowEnd)
    const windowVector = essentia.arrayToVector(window)

    // Calculate spectral features
    const centroidResult = essentia.SpectralCentroidTime(windowVector, sampleRate)
    const flatnessResult = essentia.Flatness(windowVector)
    const rmsResult = essentia.RMS(windowVector)

    const centroid = centroidResult.centroid
    const flatness = flatnessResult.flatness
    const rms = rmsResult.rms

    // Calculate confidence score based on spectral features
    const confidence = calculateConfidence(centroid, flatness, rms, cfg)

    // Only include detections above minimum confidence
    if (confidence > 0.3) {
      strikes.push({
        timestamp: onsetTime,
        confidence,
        spectralCentroid: centroid,
        spectralFlatness: flatness,
        onsetStrength: rms,
      })
      lastOnsetTime = onsetTime
    }
  }

  return strikes
}

/**
 * Calculate confidence score for a potential strike
 *
 * Golf ball strikes have characteristic spectral properties:
 * - Spectral centroid around 3000-4000 Hz (bright, percussive)
 * - Moderate spectral flatness (not pure tone, not white noise)
 * - Sufficient energy (RMS)
 */
function calculateConfidence(
  centroid: number,
  flatness: number,
  rms: number,
  _config: DetectionConfig
): number {
  // Centroid score: golf strikes typically have centroid around 3500 Hz
  // Score decreases as centroid deviates from target
  const targetCentroid = 3500
  const centroidDiff = Math.abs(centroid - targetCentroid)
  const centroidScore = Math.max(0, 1 - centroidDiff / 3000)

  // Flatness score: moderate flatness is characteristic of percussive sounds
  // Too low = tonal (not a strike), too high = noise
  let flatnessScore: number
  if (flatness >= 0.1 && flatness <= 0.6) {
    flatnessScore = 1.0
  } else if (flatness < 0.1) {
    flatnessScore = flatness / 0.1 // Ramp up from 0
  } else {
    flatnessScore = Math.max(0, 1 - (flatness - 0.6) / 0.4) // Ramp down from 0.6
  }

  // RMS score: need sufficient energy for a real strike
  // Normalize RMS (typical range 0.01-0.3 for strikes)
  const rmsScore = Math.min(1, rms / 0.1)

  // Weighted combination
  // Centroid is most important, followed by RMS, then flatness
  return centroidScore * 0.4 + rmsScore * 0.4 + flatnessScore * 0.2
}
