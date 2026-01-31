// apps/browser/src/types/tracer.ts
export interface TracerStyle {
  // Core appearance
  color: string
  lineWidth: number

  // Glow settings
  glowEnabled: boolean
  glowColor: string
  glowRadius: number

  // Markers
  showApexMarker: boolean
  showLandingMarker: boolean
  showOriginMarker: boolean

  // Animation (for future comet mode)
  styleMode: 'solid' | 'comet' | 'hybrid'
  tailLengthSeconds: number
  tailFade: boolean
}

export const DEFAULT_TRACER_STYLE: TracerStyle = {
  color: '#FF4444',
  lineWidth: 3,
  glowEnabled: true,
  glowColor: '#FF6666',
  glowRadius: 8,
  showApexMarker: true,
  showLandingMarker: true,
  showOriginMarker: true,
  styleMode: 'solid',
  tailLengthSeconds: 0.4,
  tailFade: true,
}
