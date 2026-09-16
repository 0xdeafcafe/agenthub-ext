export function releaseVersion(value) {
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value ?? '') ||
    value.split('.').some((part) => Number(part) > 65535) ||
    value === '0.0.0'
  )
    throw new Error('Use a version like 0.2.0 (three numbers, each at most 65535).');
  return value;
}

export function versionForBuild(env = process.env) {
  if (env.GITHUB_REF_TYPE !== 'tag') return undefined;
  if (!env.GITHUB_REF_NAME?.startsWith('v')) throw new Error('Release tags must start with v.');
  return releaseVersion(env.GITHUB_REF_NAME.slice(1));
}
