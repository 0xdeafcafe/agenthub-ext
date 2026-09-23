import './style.css';
import {createModelWorker} from '../../lib/ai/create-worker';
import {MODELS, modelById, type ModelId} from '../../lib/ai/models';
import {renderAnswer} from '../../lib/ai/render-answer';
import {
  QUICK_QUESTIONS,
  searchChanges,
  selectContext,
  suggestedScopes,
  citedSources,
  inScope,
  type TaskMode,
} from '../../lib/ai/search';
import type {SourceChunk, SourceIndex} from '../../lib/ai/index';
import {
  TriageError,
  groupTriage,
  triage,
  triageItems,
  triageMarkdown,
  type TriageResult,
  type TriageRow,
} from '../../lib/ai/triage';
import type {WorkerRequest, WorkerResponse} from '../../lib/ai/protocol';

const get = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const node = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text = '',
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
};
const channel = location.hash.slice(1);
const requestedOrigin = new URLSearchParams(location.search).get('parentOrigin');
// Only accept the GitHub host or the same-origin development playground.
// Messages must also match the parent window and this panel's channel below.
const parentOrigin =
  requestedOrigin === 'https://github.com' || requestedOrigin === location.origin
    ? requestedOrigin
    : '';
const count = (n: number, noun: string): string =>
  `${n.toLocaleString('en-US')} ${noun}${n === 1 ? '' : 's'}`;
const post = (data: Record<string, unknown>): void => {
  if (parentOrigin) parent.postMessage({channel, ...data}, parentOrigin);
};
const question = get<HTMLTextAreaElement>('question');
const scope = get<HTMLInputElement>('scope');
const mode = get<HTMLSelectElement>('mode');
const generated = get<HTMLInputElement>('include-generated');
const messages = get('messages');
const modelDetails = get<HTMLDetailsElement>('models');
let index: SourceIndex | null = null;
let revision = '';
let worker: Worker | null = null;
let job = 0;
let operation: 'idle' | 'load' | 'generate' | 'remove' | 'triage' = 'idle';
let triageConsent = false;
let triageRequest: AbortController | null = null;
let active: ModelId | null = null;
let installed = new Set<ModelId>();
let partial = new Set<ModelId>();
let lastQuestion = '';
let queue: ModelId[] = [];
let simulated = false;
let stopping = false;
let stopTimer: ReturnType<typeof setTimeout> | undefined;
type AnswerRequest = {
  question: string;
  mode: TaskMode;
  sources: SourceChunk[];
  previousQuestion: string;
};
let pending: {request: AnswerRequest; model?: ModelId} | null = null;
let answer: {
  element: HTMLElement;
  body: HTMLElement;
  status: HTMLElement;
  sources: HTMLElement;
  text: string;
  used: SourceChunk[];
  model: ModelId;
  question: string;
  mode: TaskMode;
  previousQuestion: string;
} | null = null;
const controls = new Map<
  ModelId,
  {use: HTMLButtonElement; remove: HTMLButtonElement; info: HTMLElement}
>();
const isBusy = (): boolean => operation !== 'idle';
const options = (): {scope: string; includeGenerated: boolean} => ({
  scope: scope.value.trim(),
  includeGenerated: generated.checked,
});
const scroll = (): void => {
  get('conversation').scrollTop = get('conversation').scrollHeight;
};
const say = (text: string): void => {
  get('task-status').textContent = text;
};
const update = (): void => {
  const busy = isBusy();
  get<HTMLButtonElement>('search').disabled = !index || busy;
  get<HTMLButtonElement>('send').disabled = !index || busy;
  get<HTMLButtonElement>('send').textContent = active ? 'Ask' : 'Load a model';
  get<HTMLButtonElement>('stop').hidden = operation !== 'generate';
  get<HTMLButtonElement>('stop').disabled = stopping;
  get<HTMLButtonElement>('stop').textContent = stopping ? 'Stopping…' : 'Stop';
  get<HTMLButtonElement>('send').hidden = operation === 'generate';
  get<HTMLButtonElement>('refresh').disabled = busy;
  get<HTMLButtonElement>('triage').disabled = !index || busy;
  get<HTMLButtonElement>('unload').disabled = !active || busy;
  get<HTMLButtonElement>('install-both').disabled = busy || installed.size === MODELS.length;
  question.disabled = busy;
  mode.disabled = busy;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-run-answer]'))
    button.disabled = busy;
  get('active-model').textContent = active ? modelById(active).name : 'No model loaded';
  get('models-summary').textContent = simulated
    ? 'Development simulation'
    : `${installed.size} of ${MODELS.length} installed${active ? ' · ' + modelById(active).name + ' active' : ''}`;
  for (const model of MODELS) {
    const control = controls.get(model.id)!;
    control.use.textContent =
      active === model.id
        ? 'Active'
        : installed.has(model.id)
          ? 'Use'
          : partial.has(model.id)
            ? 'Retry'
            : 'Install';
    control.use.disabled = busy || active === model.id;
    control.remove.disabled = busy;
    control.remove.hidden = !installed.has(model.id) && !partial.has(model.id);
    control.info.textContent = `${(model.bytes / 1e9).toFixed(2)} GB · ${partial.has(model.id) ? 'Incomplete download' : installed.has(model.id) ? 'Downloaded · available offline' : model.detail}`;
  }
};
function makeSources(sources: SourceChunk[], caption: string, open = false): HTMLElement {
  const details = node('details', 'sources');
  details.open = open;
  details.append(node('summary', '', caption));
  for (const source of sources) {
    const row = node('div', 'source');
    const button = node(
      'button',
      '',
      `[${source.id}] ${source.path} · ${source.added ? 'R' + source.newStart : 'L' + source.oldStart}`,
    );
    button.type = 'button';
    button.title = source.path;
    button.addEventListener('click', () => post({type: 'open-source', id: source.id}));
    row.append(button, node('pre', '', source.text));
    details.append(row);
  }
  return details;
}
function addAnswerActions(result: NonNullable<typeof answer>): void {
  const actions = node('div', 'answer-actions');
  const copy = node('button', '', 'Copy answer');
  copy.type = 'button';
  copy.addEventListener('click', () => {
    const citations = result.used
      .map(
        (source) =>
          `[${source.id}] ${source.path} · old ${source.oldStart}–${source.oldEnd}, new ${source.newStart}–${source.newEnd}`,
      )
      .join('\n');
    void navigator.clipboard
      .writeText(
        `${result.question}\n\n${result.text}\n\n${modelById(result.model).name} · based on selected diff excerpts\n${citations}`,
      )
      .then(
        () => say('Answer and source references copied.'),
        () => say('Could not copy. Select the answer text and copy it manually.'),
      );
  });
  actions.append(copy);
  const request: AnswerRequest = {
    question: result.question,
    mode: result.mode,
    sources: result.used,
    previousQuestion: result.previousQuestion,
  };
  const run = (model: ModelId): void => {
    if (isBusy()) return;
    question.value = request.question;
    mode.value = request.mode;
    if (active === model) generate(request);
    else {
      pending = {request, model};
      void loadModel(model);
    }
  };
  const retry = node('button', 'retry', 'Retry');
  retry.type = 'button';
  retry.dataset.runAnswer = '';
  retry.addEventListener('click', () => run(result.model));
  const other = MODELS.find((model) => model.id !== result.model)!;
  const compare = node('button', 'compare', `Compare with ${other.name}`);
  compare.type = 'button';
  compare.dataset.runAnswer = '';
  compare.addEventListener('click', () => run(other.id));
  actions.append(retry, compare);
  result.element.append(actions);
}
function resetWorker(): void {
  clearTimeout(stopTimer);
  stopping = false;
  worker?.terminate();
  worker = null;
  active = null;
  operation = 'idle';
  job++;
  get('load-progress').hidden = true;
  update();
}
function ensureWorker(): Worker {
  if (worker) return worker;
  worker = createModelWorker();
  const owner = worker;
  worker.onmessage = (event: MessageEvent<WorkerResponse>): void => {
    if (worker !== owner) return;
    const message = event.data;
    if (message.type === 'status') {
      installed = new Set(message.installed);
      partial = new Set(message.partial ?? []);
      simulated = message.simulated === true;
      if (simulated) get('pr-title').textContent = 'Development simulation · no model is running';
      update();
      return;
    }
    if (message.id !== job) return;
    if (message.type === 'progress') {
      get('load-progress').hidden = false;
      document.querySelector<HTMLProgressElement>('#load-progress progress')!.value =
        message.progress;
      get('load-message').textContent = message.text;
    } else if (message.type === 'ready') {
      active = message.model;
      installed.add(active);
      operation = 'idle';
      get('load-progress').hidden = true;
      get('model-message').textContent =
        `${modelById(active).name} ready · ${(message.loadMs / 1000).toFixed(1)}s`;
      if (queue.length) {
        const next = queue.shift()!;
        void loadModel(next);
      } else {
        modelDetails.open = false;
        say('Ready. Ask a question or choose a review shortcut.');
      }
    } else if (message.type === 'context' && answer) {
      answer.used = message.sources;
      answer.sources.replaceChildren(
        makeSources(
          message.sources,
          `Sources used · ${count(message.sources.length, 'excerpt')} · ${count(new Set(message.sources.map((source) => source.path)).size, 'file')}`,
        ),
      );
      answer.status.textContent = `Sample of ${new Set(message.sources.map((source) => source.path)).size} / ${index?.files.length ?? '?'} files · ${message.inputTokens.toLocaleString()} input tokens · ${count(message.omitted, 'other candidate excerpt')} left out`;
      say('Reading the selected excerpts…');
    } else if (message.type === 'token' && answer) {
      answer.text += message.text;
      answer.body.textContent = answer.text;
      say('Writing…');
      // Follow only when the user is already near the newest response.
      const feed = get('conversation');
      if (feed.scrollHeight - feed.scrollTop - feed.clientHeight < 100) scroll();
    } else if (message.type === 'done') {
      clearTimeout(stopTimer);
      stopping = false;
      operation = 'idle';
      if (answer) {
        answer.body.replaceChildren(
          renderAnswer(answer.text, answer.used, (id) => post({type: 'open-source', id})),
        );
        const refs = citedSources(answer.text, answer.used);
        const warning = refs.invalid.length
          ? `Unrecognized citations: ${refs.invalid.join(', ')}. Check this answer against the excerpts.`
          : !refs.valid.length
            ? 'This answer has no valid citations. Check it against the supplied excerpts.'
            : '';
        if (warning) answer.element.append(node('p', 'answer-warning', warning));
        if (message.truncated)
          answer.element.append(
            node(
              'p',
              'answer-warning',
              'The answer reached its length limit. Retry with a smaller scope or a more specific question.',
            ),
          );
        if (message.stopped)
          answer.element.append(
            node('p', 'answer-status', 'Stopped by you. This answer is incomplete.'),
          );
        if (refs.valid.length)
          answer.element.append(
            makeSources(refs.valid, `Cited evidence · ${count(refs.valid.length, 'excerpt')}`),
          );
        answer.status.textContent += ` · ${(message.elapsedMs / 1000).toFixed(1)}s · first token ${(message.firstTokenMs / 1000).toFixed(1)}s${message.outputTokens ? ` · ${message.outputTokens} output tokens` : ''}`;
        addAnswerActions(answer);
        if (!message.stopped) lastQuestion = answer.question;
        answer = null;
      }
      say(
        message.stopped
          ? 'Stopped. The model is ready for another question.'
          : 'Answer ready. Verify suggestions against the linked code.',
      );
    } else if (message.type === 'unloaded' || message.type === 'removed') {
      operation = 'idle';
      if (message.type === 'unloaded') active = null;
    } else if (message.type === 'error') {
      const failedOperation = operation;
      operation = 'idle';
      queue = [];
      if (answer) {
        answer.body.textContent = answer.text || message.message;
        answer.element.append(node('p', 'answer-warning', message.message));
        addAnswerActions(answer);
        answer = null;
      }
      resetWorker();
      if (failedOperation !== 'idle') ensureWorker();
      get('load-progress').hidden = true;
      get('model-message').textContent = message.message;
      get('model-message').dataset.error = 'true';
      say('Something went wrong. You can retry or keep using search.');
    }
    update();
    if (
      message.type === 'ready' &&
      operation === 'idle' &&
      active &&
      !queue.length &&
      pending &&
      (!pending.model || pending.model === active)
    ) {
      const next = pending;
      pending = null;
      // A newly queued question follows edits made before choosing a model.
      // Retry/compare requests keep their original evidence and prior question.
      generate(next.model ? next.request : undefined);
    }
  };
  worker.onerror = (event): void => {
    if (worker !== owner) return;
    queue = [];
    if (answer) {
      answer.body.textContent += '\nModel stopped. Reload it to retry.';
      addAnswerActions(answer);
    }
    answer = null;
    resetWorker();
    say(event.message || 'Model worker stopped. Try loading it again.');
  };
  worker.postMessage({id: job, type: 'status'} satisfies WorkerRequest);
  return worker;
}
async function loadModel(model: ModelId): Promise<void> {
  if (isBusy()) return;
  resetWorker();
  operation = 'load';
  const request = job;
  update();
  modelDetails.open = true;
  get('load-progress').hidden = false;
  document.querySelector<HTMLProgressElement>('#load-progress progress')!.value = 0;
  get('load-message').textContent = 'Checking available storage…';
  say(`Loading ${modelById(model).name}${pending ? ' for your question' : ''}…`);
  get('model-message').textContent = '';
  get('model-message').dataset.error = 'false';
  try {
    // Public model artifacts allow CORS. No broad model-host permissions are needed.
    const estimate = await navigator.storage.estimate();
    if (request !== job) return;
    if (
      !simulated &&
      !installed.has(model) &&
      estimate.quota &&
      estimate.quota - (estimate.usage ?? 0) < modelById(model).bytes * 1.1
    )
      throw new Error('Not enough browser storage. Remove a model or free some space first.');
    operation = 'load';
    active = null;
    update();
    get('load-progress').hidden = false;
    get('load-message').textContent = `Preparing ${modelById(model).name}…`;
    const current = ensureWorker();
    current.postMessage({id: ++job, type: 'load', model} satisfies WorkerRequest);
  } catch (error) {
    if (request !== job) return;
    get('load-progress').hidden = true;
    operation = 'idle';
    queue = [];
    get('model-message').textContent =
      error instanceof Error ? error.message : 'Could not start the download.';
    get('model-message').dataset.error = 'true';
    update();
  }
}
function candidates(): SourceChunk[] {
  if (!index) return [];
  const text = question.value.trim();
  const followup =
    /\b(it|that|those|these|also|what about)\b/i.test(text) && lastQuestion
      ? `${lastQuestion} ${text}`
      : text;
  return selectContext(index, followup, mode.value as TaskMode, options());
}
function generate(request?: AnswerRequest): void {
  if (!index || isBusy()) return;
  if (!question.value.trim() && mode.value !== 'ask')
    question.value = QUICK_QUESTIONS.find((quick) => quick.mode === mode.value)!.prompt;
  if (!question.value.trim()) {
    question.focus();
    return;
  }
  const sources = request?.sources ?? candidates();
  if (!sources.length) {
    say('No matching code. Try a file name or a more specific question.');
    return;
  }
  request ??= {
    question: question.value.trim(),
    mode: mode.value as TaskMode,
    sources,
    previousQuestion: lastQuestion,
  };
  if (!active) {
    pending = {request};
    modelDetails.open = true;
    say('Choose a model. Your question will run when it is ready.');
    return;
  }
  const article = node('article', 'message');
  const header = node('div', 'message-header');
  header.append(
    node('strong', '', modelById(active).name),
    node('span', '', simulated ? 'Simulated answer' : 'On device'),
  );
  const body = node('div', 'answer');
  const status = node('p', 'answer-status');
  const sourceSection = node('div', '');
  article.append(
    node('p', 'message-question', request.question),
    header,
    body,
    status,
    sourceSection,
  );
  messages.append(article);
  get('welcome').hidden = true;
  answer = {
    element: article,
    body,
    status,
    sources: sourceSection,
    text: '',
    used: sources,
    model: active,
    question: request.question,
    mode: request.mode,
    previousQuestion: request.previousQuestion,
  };
  operation = 'generate';
  update();
  say('Selecting relevant code…');
  scroll();
  ensureWorker().postMessage({
    id: ++job,
    type: 'generate',
    question: answer.question,
    sources,
    previousQuestion: request.previousQuestion,
    mode: request.mode,
  } satisfies WorkerRequest);
}
function search(): void {
  if (!index || isBusy()) return;
  const results = searchChanges(index, question.value, {...options(), limit: 12});
  const article = node('article', 'message');
  article.append(node('p', 'message-question', question.value.trim() || 'Changes in this scope'));
  if (results.length)
    article.append(
      makeSources(
        results,
        `${count(results.length, 'matching excerpt')} · local text search`,
        true,
      ),
    );
  else
    article.append(
      node('p', 'muted', 'No matching excerpts. Try an identifier, file path, or a smaller scope.'),
    );
  messages.append(article);
  get('welcome').hidden = true;
  say(`${results.length} matches. No model needed.`);
  scroll();
}
function openRow(row: TriageRow, detail: string): HTMLElement {
  const item = node('li', 'triage-row');
  const button = node('button', '', row.path);
  button.type = 'button';
  button.addEventListener('click', () => post({type: 'open-source', id: row.sourceId}));
  item.append(button, node('small', '', detail));
  return item;
}
function renderTriage(result: TriageResult): HTMLElement {
  const {careful, mechanical} = groupTriage(result.rows);
  const body = node('div', 'triage');
  const percent = (value: number | null): string =>
    value === null ? '' : `${Math.round(value * 100)}%`;
  if (!careful.length)
    body.append(node('p', 'muted', 'Nothing stands out as a risky behaviour change.'));
  for (const group of careful) {
    const section = node('section', 'triage-group');
    const list = node('ul', '');
    for (const row of group.rows) list.append(openRow(row, percent(row.risk.confidence)));
    section.append(
      node('h3', '', `${group.area[0].toUpperCase()}${group.area.slice(1)} · ${group.rows.length}`),
      list,
    );
    body.append(section);
  }
  if (mechanical.length) {
    const details = node('details', 'triage-mechanical sources');
    const list = node('ul', '');
    for (const row of mechanical) list.append(openRow(row, row.change.label));
    details.append(
      node('summary', '', `Looks mechanical · ${count(mechanical.length, 'file')}`),
      list,
    );
    body.append(details);
  }
  return body;
}
function runTriage(): void {
  if (!index || isBusy()) return;
  const {items, skipped} = triageItems(index, options().scope);
  if (!items.length) {
    say('No code files in this scope. Tests, docs and generated files are already sorted.');
    return;
  }
  get('welcome').hidden = true;
  if (!triageConsent) {
    const card = node('article', 'message triage-consent');
    const actions = node('div', 'answer-actions');
    const send = node('button', 'primary', `Send ${count(items.length, 'file')}`);
    send.type = 'button';
    const cancel = node('button', '', 'Cancel');
    cancel.type = 'button';
    send.addEventListener('click', () => {
      triageConsent = true;
      card.remove();
      runTriage();
    });
    cancel.addEventListener('click', () => {
      card.remove();
      if (!messages.childElementCount) get('welcome').hidden = false;
      say('Nothing was sent.');
    });
    actions.append(send, cancel);
    card.append(
      node(
        'p',
        '',
        `Send the diff for ${count(items.length, 'code file')} to classifier.dev? It leaves this browser and is classified on their servers. The free tier is limited per IP address.`,
      ),
      actions,
    );
    messages.append(card);
    scroll();
    return;
  }
  const article = node('article', 'message');
  const header = node('div', 'message-header');
  header.append(node('strong', '', 'classifier.dev'), node('span', 'remote-badge', 'Off device'));
  const status = node('p', 'answer-status', `Classifying ${count(items.length, 'code file')}…`);
  article.append(
    node('p', 'message-question', `Triage${options().scope ? ` · ${options().scope}` : ''}`),
    header,
    status,
  );
  messages.append(article);
  scroll();
  operation = 'triage';
  triageRequest = new AbortController();
  const request = triageRequest;
  update();
  say('Sorting code files…');
  void triage(items, {signal: request.signal})
    .then((result) => {
      const full: TriageResult = {...result, skipped};
      status.textContent = `${count(result.rows.length, 'file')} in ${(result.ms / 1000).toFixed(1)}s · ${result.model}${skipped ? ` · ${count(skipped, 'test, spec or docs file')} sorted by path instead` : ''}. Scores are leads, not proof.`;
      status.before(renderTriage(full));
      const actions = node('div', 'answer-actions');
      const copy = node('button', '', 'Copy triage');
      copy.type = 'button';
      copy.addEventListener('click', () => {
        void navigator.clipboard.writeText(triageMarkdown(full)).then(
          () => say('Triage copied as Markdown.'),
          () => say('Could not copy. Select the text and copy it manually.'),
        );
      });
      const retry = node('button', '', 'Retry');
      retry.type = 'button';
      retry.dataset.runAnswer = '';
      retry.addEventListener('click', runTriage);
      actions.append(copy, retry);
      article.append(actions);
      say('Triage ready. Open a file to review it.');
    })
    .catch((error: unknown) => {
      if (request.signal.aborted) {
        status.textContent = 'Stopped. Nothing more was sent.';
        return;
      }
      status.textContent =
        error instanceof TriageError
          ? error.message
          : 'Couldn’t reach classifier.dev. Check your connection and try again.';
      status.className = 'answer-warning';
      say('Triage failed. Search and on-device models still work.');
    })
    .finally(() => {
      if (triageRequest !== request) return;
      triageRequest = null;
      operation = 'idle';
      update();
    });
}
function clear(): void {
  triageRequest?.abort();
  triageRequest = null;
  if (operation === 'triage') operation = 'idle';
  if (operation === 'generate') {
    ensureWorker().postMessage({id: job, type: 'stop'} satisfies WorkerRequest);
    resetWorker();
  }
  messages.replaceChildren();
  answer = null;
  lastQuestion = '';
  pending = null;
  get('welcome').hidden = false;
  say(index ? 'Ready to search.' : 'Loading the diff…');
  update();
}
for (const model of MODELS) {
  const card = node('div', 'model-card');
  const info = node('div', '');
  const detail = node('small', '');
  info.append(node('strong', '', model.name), detail);
  const use = node('button', '', 'Install');
  use.type = 'button';
  use.setAttribute('aria-label', `Install or use ${model.name}`);
  use.addEventListener('click', () => {
    void loadModel(model.id);
  });
  const remove = node('button', '', 'Remove');
  remove.type = 'button';
  remove.setAttribute('aria-label', `Remove ${model.name}`);
  remove.addEventListener('click', () => {
    if (isBusy()) return;
    operation = 'remove';
    if (active === model.id) active = null;
    update();
    ensureWorker().postMessage({
      id: ++job,
      type: 'remove',
      model: model.id,
    } satisfies WorkerRequest);
  });
  controls.set(model.id, {use, remove, info: detail});
  card.append(info, use, remove);
  get('model-cards').append(card);
}
for (const quick of QUICK_QUESTIONS) {
  const button = node('button', '', quick.label);
  button.type = 'button';
  button.addEventListener('click', () => {
    mode.value = quick.mode;
    question.value = quick.prompt;
    generate();
  });
  get('quick-questions').append(button);
}
get('install-both').addEventListener('click', () => {
  queue = MODELS.filter((model) => !installed.has(model.id)).map((model) => model.id);
  const next = queue.shift();
  if (next) void loadModel(next);
});
get('cancel-load').addEventListener('click', () => {
  queue = [];
  pending = null;
  resetWorker();
  ensureWorker();
  say(
    'Download cancelled. Completed downloads are kept; incomplete ones can be retried or removed.',
  );
});
get('unload').addEventListener('click', () => {
  resetWorker();
  ensureWorker();
  say('Model unloaded. Its download is kept.');
});
get('stop').addEventListener('click', () => {
  if (operation !== 'generate' || stopping) return;
  stopping = true;
  worker?.postMessage({id: job, type: 'stop'} satisfies WorkerRequest);
  say('Stopping the answer…');
  update();
  stopTimer = setTimeout(() => {
    if (answer) {
      answer.element.append(
        node('p', 'answer-status', 'Stopped. The model was unloaded because it did not respond.'),
      );
      addAnswerActions(answer);
      answer = null;
    }
    resetWorker();
    ensureWorker();
    say('Stopped. Load the cached model to continue.');
  }, 5000);
});
get('search').addEventListener('click', search);
get('triage').addEventListener('click', runTriage);
get('send').addEventListener('click', () => generate());
get('clear').addEventListener('click', clear);
get('close').addEventListener('click', () => post({type: 'close'}));
get('refresh').addEventListener('click', () => post({type: 'refresh'}));
question.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    generate();
  }
});
scope.addEventListener('change', () => {
  if (index && !index.files.some((file) => inScope(file.path, scope.value.trim())))
    say('No changed files match this scope.');
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') post({type: 'close'});
});
window.addEventListener('pagehide', () => worker?.terminate());
window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== parent || event.origin !== parentOrigin || event.data?.channel !== channel)
    return;
  const message = event.data;
  if (message.type === 'suspend') {
    triageRequest?.abort();
    queue = [];
    pending = null;
    if (answer) {
      answer.element.append(node('p', 'answer-status', 'Stopped when the panel was closed.'));
      addAnswerActions(answer);
      answer = null;
    }
    resetWorker();
    say('Conversation kept for this PR. Load a cached model to continue.');
  } else if (message.type === 'resume') {
    ensureWorker();
  } else if (message.type === 'context') {
    const next = message.index as SourceIndex;
    if (!next || !Array.isArray(next.chunks) || !Array.isArray(next.files)) return;
    if (revision && revision !== next.revision) clear();
    index = next;
    revision = next.revision;
    scope.value = typeof message.scope === 'string' ? message.scope : '';
    get('coverage').textContent =
      `${count(index.files.length, 'file')} · ${count(index.chunks.length, 'excerpt')}${index.omittedChunks ? ` · ${count(index.omittedChunks, 'excerpt')} omitted` : ''}${index.truncatedLines ? ' · long lines shortened' : ''}`;
    if (!simulated) get('pr-title').textContent = message.title;
    document.documentElement.dataset.theme = message.theme;
    const paths = new Set<string>();
    for (const file of index.files) {
      const parts = file.path.split('/');
      for (let i = 1; i <= parts.length; i++) paths.add(parts.slice(0, i).join('/'));
    }
    const datalist = get('scope-options');
    datalist.replaceChildren();
    for (const path of [...paths].sort()) {
      const option = document.createElement('option');
      option.value = path;
      datalist.append(option);
    }
    const suggestions = get('suggested-scopes');
    suggestions.replaceChildren();
    for (const suggestion of suggestedScopes(index)) {
      const button = node('button', '', `${suggestion.path} · ${suggestion.files}`);
      button.type = 'button';
      button.title = suggestion.path;
      button.addEventListener('click', () => {
        scope.value = suggestion.path;
        say(`Scoped to ${suggestion.path}.`);
      });
      suggestions.append(button);
    }
    say('Ready to search.');
    update();
  } else if (message.type === 'loading') {
    index = null;
    update();
    say('Reading the current diff…');
  } else if (message.type === 'error') {
    index = null;
    update();
    get('coverage').textContent = message.message;
    say('Refresh to try again.');
  } else if (message.type === 'theme') document.documentElement.dataset.theme = message.theme;
});
update();
ensureWorker();
post({type: 'ready'});
