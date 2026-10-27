// Shared by the isolated content script and Node tests. Never reads page scripts or cookies.
(function (root) {
  function modelState(labels) {
    // Require an explicit Flash-Lite label in a visible model selector, never page prose.
    const found = labels.filter(s => /^(?:gemini\s+)?(?:3\.1\s+)?flash[\s-]*lite$/i.test(s.trim()));
    if (found.length === 1 && labels.length === 1) return {model: 'verified', modelLabel: found[0]};
    return {model: 'unknown', modelLabel: labels.join(' | ') || '선택 상태를 확인할 수 없음'};
  }
  function imageState(prompt, activeTool) {
    if (activeTool) return 'verified';
    if (/(image|picture|photo|draw|illustrat|이미지|그림|사진|그려|일러스트)/i.test(prompt)) return 'uncertain';
    return 'none';
  }
  root.CarbonDetector = {modelState, imageState};
})(globalThis);
