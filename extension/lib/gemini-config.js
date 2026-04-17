// Non-secret Gemini product settings. User API key lives only in chrome.storage (StorageManager).

const GeminiConfig = {
  MODEL_ID: 'gemini-2.5-flash',
  temperature: 0.8,
  /** maxOutputTokens per call type — adjust if responses truncate */
  maxOutputTokens: {
    confirm: 256,
    recommend: 1536,
    generate: 2048
  }
};
