// 단서 카드 그리기. clue = clueFor(target, level) 결과({level, fp, counts?, layers?, top?, front?, side?}).
// 크기는 모두 cqw(게임 화면 너비의 1%). 카드는 너비 18cqw, 안쪽 너비 약 15.5cqw.
const INNER = 15.5; // 카드 안쪽 너비(cqw) = 18 − 좌우 여백 .7×2 − 테두리 .35×2 − 여유
const SHORT = ['', '3D 모양', '위에서 본 모양 · 수', '층별 단서', '위·앞·옆에서 본 모양'];

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// 칸 한 변: 최대 max, n칸과 사이 간격(gaps개)이 avail 안에 들어오도록 줄인다.
const fit = (max, avail, n, gaps, gap) => Math.min(max, (avail - gaps * gap) / n);

// rows: 2차원 배열. 값이 true/수(>0)면 칠한 칸, 수면 숫자도 쓴다.
function grid(rows, size, gap) {
  const g = el('div', 'g');
  const cols = rows[0]?.length ?? 0;
  g.style.gridTemplateColumns = `repeat(${cols}, ${size}cqw)`;
  g.style.setProperty('--cs', `${size}cqw`);
  g.style.setProperty('--gap', `${gap}cqw`);
  for (const row of rows) {
    for (const v of row) {
      const c = el('div', v ? 'f' : '');
      if (typeof v === 'number' && v > 0) c.textContent = String(v);
      g.append(c);
    }
  }
  return g;
}

const cap = (text) => el('div', 'cap', text);

function level1() {
  const ic = el('div', 'lead-ic');
  ic.innerHTML = '<svg aria-hidden="true" style="color:#2FC8F0"><use href="#i-box"/></svg>';
  const p = el('div', 'cap lead');
  p.append('판 위에 ', el('b', '', '빛나는 모양'), '을', document.createElement('br'), '그대로 채워요');
  return [ic, p];
}

function level2(clue) {
  const { w } = clue.fp;
  const gap = 0.3;
  const s = fit(2.4, INNER, w, w - 1, gap);
  return [grid(clue.counts, s, gap), cap('수 = 그 자리에 쌓인 개수')];
}

function level3(clue) {
  const { w } = clue.fp;
  const gap = 0.3;
  const s = fit(2.2, INNER, w, w - 1, gap);
  const out = [];
  clue.layers.forEach((layer, i) => out.push(grid(layer, s, gap), cap(`${i + 1}층`)));
  return out;
}

// 교과서 배치: 위에서 본 모양, 그 아래 앞, 앞의 오른쪽에 옆.
function level4(clue) {
  const { w, d } = clue.fp;
  const gap = 0.2, colgap = 0.6;
  const s = fit(2, INNER - colgap, w + d, w + d - 2, gap);
  const views = el('div', 'views');
  views.style.setProperty('--colgap', `${colgap}cqw`);
  const box = (area, rows, label) => {
    const b = el('div');
    b.style.gridArea = area;
    b.append(grid(rows, s, gap), cap(label));
    return b;
  };
  views.append(box('top', clue.top, '위'), box('front', clue.front, '앞'), box('side', clue.side, '옆'));
  return [views];
}

// card: 단서 카드 요소(.lvl, .clue-body 를 담음). opts.easy 면 "쉬운 단서" 표시.
export function renderClue(card, clue, { easy = false } = {}) {
  const lvl = card.querySelector('.lvl');
  if (lvl) {
    lvl.textContent = easy ? `쉬운 단서 · ${SHORT[clue.level]}` : SHORT[clue.level];
    lvl.classList.toggle('is-easy', easy);
  }
  const body = card.querySelector('.clue-body') ?? card;
  const parts = clue.level === 1 ? level1()
    : clue.level === 2 ? level2(clue)
      : clue.level === 3 ? level3(clue)
        : level4(clue);
  body.replaceChildren(...parts);
  body.dataset.level = String(clue.level);
}
