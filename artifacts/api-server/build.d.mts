export function hashClientSriDigests(
  distDir: string,
): Promise<Record<string, string>>;

export function writeProvenance(distDir: string): Promise<void>;
