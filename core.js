export const MODEL = 'gemini-3.1-flash-lite-image';
export const MAX_PROMPT = 16000;
export const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';
export function requestBody(prompt) {
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > MAX_PROMPT) throw new Error('프롬프트는 1~16000자여야 합니다.');
  return {contents: [{role: 'user', parts: [{text: prompt}]}], generationConfig: {responseModalities: ['TEXT', 'IMAGE'], imageConfig: {imageSize: '1K'}}};
}
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
export function usageFrom(data) {
  const u = data?.usageMetadata;
  const details = value => Array.isArray(value) ? value.map(x => ({modality: String(x.modality ?? 'UNKNOWN'), tokenCount: count(x.tokenCount)})) : null;
  return {input: count(u?.promptTokenCount), output: count(u?.candidatesTokenCount), thoughts: count(u?.thoughtsTokenCount), total: count(u?.totalTokenCount), promptDetails: details(u?.promptTokensDetails), outputDetails: details(u?.candidatesTokensDetails), raw: u ?? null};
}
// User-provided provisional assumption; not a measured Gemini energy coefficient.
export const ASSUMED_WH_PER_TOKEN = 0.001518;
// User-provided US scenario; source/year and actual serving region are unverified.
export const US_KG_CO2EQ_PER_KWH = 0.341;
export function energyEstimate(totalTokens) {
  const wh = count(totalTokens) === null ? null : totalTokens * ASSUMED_WH_PER_TOKEN;
  return {whPerToken: ASSUMED_WH_PER_TOKEN, wh,
    kgCO2eqPerKwh: US_KG_CO2EQ_PER_KWH,
    carbonGrams: wh === null ? null : (wh / 1000) * US_KG_CO2EQ_PER_KWH * 1000,
    basis: 'separate-api-total-tokens', verified: false};
}
export function summarize(data) {
  const parts = (data.candidates ?? []).flatMap(c => c.content?.parts ?? []);
  const usage = usageFrom(data);
  return {usage, energy: energyEstimate(usage.total), images: parts.filter(p => p.inlineData?.mimeType?.startsWith('image/')).length,
    text: parts.filter(p => typeof p.text === 'string' && !p.thought).map(p => p.text).join('\n').slice(0, 4000),
    finishReasons: (data.candidates ?? []).map(c => c.finishReason ?? 'UNKNOWN'), blockReason: data.promptFeedback?.blockReason ?? null, modelVersion: data.modelVersion ?? null};
}
export function canAuto(settings, evidence) {
  return settings.tracking === true && settings.consent === true && evidence?.submission === 'verified' && (evidence?.model === 'verified' || settings.fixedModelConsent === true) && evidence?.image === 'verified' && evidence?.attachments !== true;
}
export function cleanError(message, key) {
  return String(message).split(key || '\u0000').join('[REDACTED]').slice(0, 1200);
}
