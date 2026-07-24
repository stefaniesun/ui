export interface QualityRegion {
  regionId: string
  total: number
  critical: boolean
  geometryErrorPx: number
  ocrMatch: number | null
  severeDefects: string[]
}
export interface QualitySnapshot { total: number; regions: QualityRegion[]; codeHealthy: boolean }
export interface GateResult { passed: boolean; failures: string[] }

export function evaluateGates(snapshot: QualitySnapshot): GateResult {
  const failures: string[] = []
  if (snapshot.total < 0.88) failures.push('total')
  if (snapshot.regions.some(region => region.critical && region.total < 0.85)) failures.push('critical-region')
  if (snapshot.regions.some(region => region.geometryErrorPx > 4)) failures.push('geometry')
  if (snapshot.regions.some(region => region.ocrMatch !== null && region.ocrMatch < 0.98)) failures.push('ocr')
  if (snapshot.regions.some(region => region.severeDefects.length > 0)) failures.push('severe-defect')
  if (!snapshot.codeHealthy) failures.push('code-health')
  return { passed: failures.length === 0, failures }
}
