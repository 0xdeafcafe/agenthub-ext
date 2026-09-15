import {existsSync} from 'node:fs';
import {chromium} from 'playwright-core';

/** Portable browser lookup; set PRIX_BROWSER to use a specific installation. */
export function browserPath({extension = false} = {}) {
  const paths = [process.env.PRIX_BROWSER, chromium.executablePath()];
  if (!extension)
    paths.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
    );
  const found = paths.find((path) => path && existsSync(path));
  if (!found)
    throw new Error(
      'No compatible browser found. Run npm run test:browser:install or set PRIX_BROWSER to a Chromium executable.',
    );
  return found;
}
