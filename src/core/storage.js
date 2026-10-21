// localStorage 안전 래퍼. 없거나 막혀 있어도 예외 없이 동작한다(DOM 직접 의존 금지).
const PREFIX = 'ck.';

export function load(name, fallback) {
  try {
    const raw = globalThis.localStorage?.getItem(PREFIX + name);
    if (raw === null || raw === undefined) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(name, value) {
  try {
    globalThis.localStorage?.setItem(PREFIX + name, JSON.stringify(value));
  } catch {
    // 저장 실패는 무시한다.
  }
}
