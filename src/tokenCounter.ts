import { countTokens as countAnthropicTokens } from '@anthropic-ai/tokenizer';
import { getEncoding, type Tiktoken } from 'js-tiktoken';
import { AssistantContextSnapshot, AssistantTokenUsage } from './assistantTypes';
import { CliProfile, CliTokenizerConfig, inferTokenizerFromModelId } from './cliProfiles';
import { renderAssistantContext } from './promptBuilder';

const openAiEncoders = new Map<string, Tiktoken>();

export function countContextTokens(
  snapshot: AssistantContextSnapshot,
  profile: CliProfile,
  modelId?: string
): AssistantTokenUsage {
  const tokenizer = profile.tokenizer ?? inferTokenizerFromModelId(modelId);
  if (!tokenizer) {
    return {
      precision: 'unavailable',
      reason: `${profile.name} does not expose a local tokenizer for its current model.`,
    };
  }

  const text = renderAssistantContext(snapshot);

  try {
    switch (tokenizer.provider) {
      case 'openai':
        return {
          precision: 'exact',
          tokens: getOpenAiEncoding(tokenizer.encoding).encode(text).length,
          tokenizer: tokenizer.label,
        };
      case 'anthropic':
        return {
          precision: 'exact',
          tokens: countAnthropicTokens(text),
          tokenizer: tokenizer.label,
        };
    }
  } catch (error) {
    return {
      precision: 'unavailable',
      tokenizer: tokenizer.label,
      reason: error instanceof Error ? error.message : `${profile.name} tokenizer failed.`,
    };
  }
}

function getOpenAiEncoding(encoding: 'o200k_base' | 'cl100k_base'): Tiktoken {
  const cached = openAiEncoders.get(encoding);
  if (cached) {
    return cached;
  }

  const encoder = getEncoding(encoding);
  openAiEncoders.set(encoding, encoder);
  return encoder;
}
