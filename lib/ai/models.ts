export const MODEL_ORIGINS = ['https://huggingface.co/*', 'https://*.hf.co/*'];
export const MODELS = [
  {
    id: 'qwen',
    name: 'Qwen3.5 2B',
    detail: 'Smaller download · good starting point',
    bytes: 1_080_000_000,
    repo: 'mlc-ai/Qwen3.5-2B-q4f16_1-MLC',
    revision: 'dd74e9c8a20c4546df85c844103bff87b6dcacad',
    runtimeId: 'Qwen3.5-2B-q4f16_1-MLC',
    tokenizerRepo: 'mlc-ai/Qwen3.5-2B-q4f16_1-MLC',
    tokenizerRevision: 'dd74e9c8a20c4546df85c844103bff87b6dcacad',
  },
  {
    id: 'gemma',
    name: 'Gemma 4 E2B',
    detail: 'Larger download · compare answers',
    bytes: 2_040_602_266,
    repo: 'litert-community/gemma-4-E2B-it-litert-lm',
    revision: 'b3ca0d2f076785a8f4b2219ddbd2bdb99954eae1',
    runtimeId: 'gemma-4-E2B-it-web.litertlm',
    tokenizerRepo: 'google/gemma-4-E2B-it',
    tokenizerRevision: '3e22461f65e89153144f8adb70e3b8c2cc9845a7',
  },
] as const;
export type ModelId = (typeof MODELS)[number]['id'];
export const modelById = (id: ModelId): (typeof MODELS)[number] =>
  MODELS.find((model) => model.id === id)!;
export const modelUrl = (id: ModelId): string => {
  const m = modelById(id);
  return `https://huggingface.co/${m.repo}/resolve/${m.revision}/`;
};
export const tokenizerUrl = (id: ModelId): string => {
  const m = modelById(id);
  return `https://huggingface.co/${m.tokenizerRepo}/resolve/${m.tokenizerRevision}/tokenizer.json`;
};
