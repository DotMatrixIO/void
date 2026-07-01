export interface DisplayMediaAudioViolation {
  file: string;
  line: number;
  rule: string;
  detail: string;
}

export interface ScanArtifactsResult {
  violations: DisplayMediaAudioViolation[];
  roots: string[];
  files: string[];
}

export function scanArtifacts(artifactsRoot?: string): ScanArtifactsResult;
