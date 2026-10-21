// 입력: 조각 끌기, 톡 누르기·길게 누르기 → 돌리기 링(버튼 3개), 빈 곳 끌기·두 손가락 → 회전판.
// 포인터 이벤트 하나로 터치(학교 태블릿·크롬북)와 마우스(교사 PC)를 함께 처리한다.
// 조각 좌표는 판 좌표다. 끌기·돌리기 결과는 movePiece/rotatePiece 로 만들고(작업대 안, 위에서 떨어뜨림)
// setPiece(i, piece) 로 넘긴 뒤 world.updatePiece 로 화면에 반영한다.
import { movePiece, rotatePiece } from '../core/layout.js';

const DRAG_PX = 8; // 이보다 많이 움직여야 끌기
const LONG_MS = 450; // 길게 누르기
const SPIN_K = 0.008; // 회전판 감도(rad/px)
const STALE_MS = 2000; // 이만큼 움직임 없는 포인터는 떼기를 놓친 유령으로 보고 버린다

// 링 버튼 배치(링 중심 기준 px). 버튼 56px, 글자는 버튼 아래.
const BTN = 56;
const RING_BUTTONS = [
  { axis: 'y', label: '돌리기', dx: 0, dy: -72,
    icon: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>' },
  { axis: 'x', label: '세우기', dx: -70, dy: 26,
    icon: '<path d="M3 12h18"/><path d="m7 8 5-4 5 4"/><path d="m7 16 5 4 5-4"/>' },
  { axis: 'z', label: '뒤집기', dx: 70, dy: 26,
    icon: '<path d="M12 3v18"/><path d="m16 7 4 5-4 5"/><path d="m8 7-4 5 4 5"/>' },
];
const LABEL_GAP = BTN / 2 + 4; // 버튼 중심에서 글자 위쪽까지
const LABEL_H = 26;
const LABEL_HALF_W = 36;
// 링 전체가 차지하는 범위(중심 기준) + 여백 → 화면 안에 다 들어오도록 중심을 제한한다
const EDGE = 8;
const EXT = {
  left: Math.max(...RING_BUTTONS.map((b) => Math.max(BTN / 2, LABEL_HALF_W) - b.dx)) + EDGE,
  right: Math.max(...RING_BUTTONS.map((b) => b.dx + Math.max(BTN / 2, LABEL_HALF_W))) + EDGE,
  top: Math.max(...RING_BUTTONS.map((b) => BTN / 2 - b.dy)) + EDGE,
  bottom: Math.max(...RING_BUTTONS.map((b) => b.dy + LABEL_GAP + LABEL_H)) + EDGE,
};

const STYLE_ID = 'ck-ring-style';
const RING_CSS = `
.ck-ring{position:absolute;left:0;top:0;width:0;height:0;display:none;z-index:5}
.ck-ring.on{display:block}
.ck-ring button{position:absolute;transform:translate(-50%,-50%);width:${BTN}px;height:${BTN}px;padding:0;border-radius:50%;cursor:pointer;touch-action:manipulation;
  color:#5A2C00;background:linear-gradient(180deg,var(--gold-1,#FFF1A6),var(--gold-2,#FFC529) 50%,var(--gold-3,#F29B00));
  border:3px solid #FFF4B8;box-shadow:0 5px 0 var(--gold-edge,#B4690A),0 9px 16px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center}
.ck-ring button:active{transform:translate(-50%,-50%) translateY(3px);box-shadow:0 2px 0 var(--gold-edge,#B4690A),0 5px 10px rgba(0,0,0,.35)}
.ck-ring button:focus-visible{outline:3px solid #8FEFFF;outline-offset:2px}
.ck-ring svg{width:28px;height:28px;pointer-events:none}
.ck-ring small{position:absolute;transform:translate(-50%,0);font:16px/1.4 Jua,Pretendard,sans-serif;color:#fff;
  background:rgba(36,22,74,.85);border-radius:6px;padding:1px 8px;white-space:nowrap;pointer-events:none}
`;

function ensureStyle(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const s = doc.createElement('style');
  s.id = STYLE_ID;
  s.textContent = RING_CSS;
  doc.head.appendChild(s);
}

function buildRing(doc) {
  const el = doc.createElement('div');
  el.id = 'ring';
  el.className = 'ck-ring';
  el.setAttribute('role', 'toolbar');
  el.setAttribute('aria-label', '조각 돌리기');
  for (const b of RING_BUTTONS) {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.dataset.axis = b.axis;
    btn.setAttribute('aria-label', b.label);
    btn.style.left = `${b.dx}px`;
    btn.style.top = `${b.dy}px`;
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"'
      + ` stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${b.icon}</svg>`;
    const small = doc.createElement('small');
    small.textContent = b.label;
    small.style.left = `${b.dx}px`;
    small.style.top = `${b.dy + LABEL_GAP}px`;
    el.append(btn, small);
  }
  return el;
}

export function attachInput({
  canvas, stage, world, getPieces,
  setPiece = () => {}, onDrop = () => {}, onSelect = () => {}, onRotate = () => {},
}) {
  const doc = canvas.ownerDocument;
  ensureStyle(doc);
  const ring = buildRing(doc);
  stage.appendChild(ring);

  const ptrs = new Map(); // pointerId -> {x, y, t(마지막 down/move 시각)}
  let drag = null; // {i, id, sx, sy, off:[x,z], moved, longShown}
  let spin = null; // {x, moved}
  let timer = 0;
  let selected = null;

  const ndcOf = (x, y) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((x - r.left) / r.width) * 2 - 1, y: -((y - r.top) / r.height) * 2 + 1 };
  };
  const avgX = () => {
    let s = 0;
    for (const p of ptrs.values()) s += p.x;
    return s / ptrs.size;
  };

  function showRing(i, x, y) {
    const r = stage.getBoundingClientRect();
    const clamp = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.min(Math.max(v, lo), hi));
    const cx = clamp(x - r.left, EXT.left, r.width - EXT.right);
    const cy = clamp(y - r.top, EXT.top, r.height - EXT.bottom);
    ring.style.left = `${cx}px`;
    ring.style.top = `${cy}px`;
    ring.classList.add('on');
    selected = i;
    onSelect(i, { x, y });
  }
  const hideRing = () => ring.classList.remove('on');
  const clearTimer = () => { clearTimeout(timer); timer = 0; };

  // 끌기 중 한 번 옮기기(판 좌표, 정수로 반올림 후 movePiece)
  function dragTo(x, y) {
    const f = world.floorPoint(ndcOf(x, y));
    if (!f) return;
    const pieces = getPieces();
    const p = pieces[drag.i];
    if (!p) return; // 문제가 바뀌어 조각이 없어졌다
    const next = movePiece(p, Math.round(f.x - drag.off[0]), Math.round(f.z - drag.off[1]), pieces, world.center());
    setPiece(drag.i, next);
    world.updatePiece(drag.i, next, { lift: true });
  }

  // 끌기 끝(떼기·취소·캡처 잃음·두 번째 포인터): 마지막 칸에 내려놓는다
  function land() {
    const i = drag.i;
    drag = null;
    const pieces = getPieces();
    if (!pieces[i]) return; // 문제가 바뀌어 조각이 없어졌다
    const next = movePiece(pieces[i], pieces[i].pos[0], pieces[i].pos[2], pieces, world.center());
    setPiece(i, next);
    world.updatePiece(i, next, { lift: false });
    world.bounce(i);
    onDrop(i);
  }

  // 끌기 상태를 끝낸다. tap=true 면 움직이지 않은 짧은 누름을 탭으로 본다.
  function endDrag(tap, x, y) {
    clearTimer();
    if (!drag) return;
    if (drag.moved) { land(); return; }
    const { i, longShown } = drag;
    drag = null;
    if (tap && !longShown) showRing(i, x, y);
  }

  function startSpin() {
    spin = { x: avgX(), moved: false };
    hideRing();
  }

  // 떼기(pointerup)를 놓쳐 남은 포인터를 정리한다. 끌던 조각이면 내려놓는다.
  const drop = (id) => {
    const p = ptrs.get(id);
    if (p) release({ pointerId: id, clientX: p.x, clientY: p.y }, false);
  };

  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const now = performance.now();
    if (e.pointerType === 'mouse') {
      // 마우스는 하나뿐이다. 새로 누르면 남은 포인터(유령 터치 포함)는 모두 지난 것이다.
      for (const id of [...ptrs.keys()]) drop(id);
      ptrs.clear();
      spin = null;
    } else {
      for (const [id, p] of [...ptrs]) if (now - p.t > STALE_MS) drop(id);
    }
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, t: now });
    try { canvas.setPointerCapture(e.pointerId); } catch { /* 이미 사라진 포인터 */ }
    hideRing();
    if (ptrs.size > 1) {
      if (drag) endDrag(false);
      startSpin();
      spin.moved = true; // 두 손가락은 탭이 아니다
      return;
    }
    const i = world.pickPiece(ndcOf(e.clientX, e.clientY));
    if (i < 0) { startSpin(); return; }
    const p = getPieces()[i];
    const f = world.floorPoint(ndcOf(e.clientX, e.clientY));
    drag = {
      i, id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false, longShown: false,
      off: f ? [f.x - p.pos[0], f.z - p.pos[2]] : [0, 0],
    };
    const { clientX, clientY } = e;
    timer = setTimeout(() => {
      timer = 0;
      if (drag && !drag.moved) {
        drag.longShown = true;
        showRing(drag.i, clientX, clientY);
      }
    }, LONG_MS);
  }

  function onMove(e) {
    if (!ptrs.has(e.pointerId)) return;
    // 버튼이 눌려 있지 않은 마우스·펜 이동 = 떼기를 놓친 포인터
    if (e.pointerType !== 'touch' && e.buttons === 0) { drop(e.pointerId); return; }
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
    if (spin) {
      const x = avgX();
      if (x !== spin.x) {
        world.setSpin(world.getSpin() + (x - spin.x) * SPIN_K);
        spin.x = x;
        spin.moved = true;
      }
      return;
    }
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) <= DRAG_PX) return;
      drag.moved = true;
      clearTimer();
      hideRing();
    }
    dragTo(e.clientX, e.clientY);
  }

  // 포인터 하나가 끝났다. tap: 정상 떼기인지(취소가 아닌지)
  function release(e, tap) {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (drag && e.pointerId === drag.id) {
      endDrag(tap, e.clientX, e.clientY);
    } else if (spin) {
      if (ptrs.size === 0) {
        if (tap && !spin.moved) {
          hideRing();
          selected = null;
          onSelect(null, { x: e.clientX, y: e.clientY });
        }
        spin = null;
      } else {
        spin.x = avgX(); // 남은 손가락 기준으로 이어서 돌린다
      }
    }
  }

  const onUp = (e) => release(e, true);
  const onCancel = (e) => release(e, false);
  const onLost = (e) => release(e, false); // 떼기 뒤에는 이미 지워져 있어 아무 일도 없다

  // 링 버튼: 캔버스 끌기와 섞이지 않게 포인터 이벤트를 여기서 멈춘다
  const stop = (e) => e.stopPropagation();
  const noMenu = (e) => e.preventDefault();
  function onRingClick(e) {
    const btn = e.target.closest('button[data-axis]');
    if (!btn || selected === null) return;
    const axis = btn.dataset.axis;
    const i = selected;
    const pieces = getPieces();
    if (!pieces[i]) return;
    const next = rotatePiece(pieces[i], axis, pieces, world.center());
    setPiece(i, next);
    world.updatePiece(i, next, { lift: false });
    world.bounce(i);
    onRotate(i, axis);
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('lostpointercapture', onLost);
  canvas.addEventListener('contextmenu', noMenu);
  ring.addEventListener('pointerdown', stop);
  ring.addEventListener('click', onRingClick);
  if (!canvas.style.touchAction) canvas.style.touchAction = 'none';

  return {
    detach() {
      clearTimer();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('lostpointercapture', onLost);
      canvas.removeEventListener('contextmenu', noMenu);
      ring.remove();
      ptrs.clear();
      drag = null;
      spin = null;
    },
    // 진행 중인 끌기·길게 누르기·회전판·선택·링을 버린다(문제를 바꾸거나 다시 놓을 때). 리스너는 그대로 둔다.
    // 남은 포인터의 이동·떼기 이벤트는 모르는 포인터로 보고 무시한다.
    cancel() {
      clearTimer();
      ptrs.clear();
      drag = null;
      spin = null;
      selected = null;
      hideRing();
    },
    resetSpin() {
      world.setSpin(0);
      hideRing();
    },
    // 확인용(e2e): 링 상태
    ringState: () => ({
      visible: ring.classList.contains('on'),
      index: selected,
      x: parseFloat(ring.style.left) || 0,
      y: parseFloat(ring.style.top) || 0,
    }),
    hideRing,
  };
}
