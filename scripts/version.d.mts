export function releaseVersion(value: string): string;
export function versionForBuild(env?: {
  GITHUB_REF_TYPE?: string;
  GITHUB_REF_NAME?: string;
}): string | undefined;
