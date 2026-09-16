import {defineUnlistedScript} from 'wxt/utils/define-unlisted-script';
import '../lib/ai/worker';

// An explicit entrypoint keeps WXT's import.meta transform from losing the worker bundle.
export default defineUnlistedScript(() => {});
