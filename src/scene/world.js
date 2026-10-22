// 3D 장면: 빛, 그림자 전용 바닥, 회전판, 판(보라 틀 + 금테 + 크림 칸 + "앞" 표시), 목표 모양, 조각 메시.
// 카메라는 calibrate.js 로 그림 시점에 고정하고, 화면을 돌리면 회전판 그룹만 Y축으로 돈다.
// 판 중심이 월드 원점이다(grid 그룹을 판 중심만큼 거꾸로 옮긴다). 조각·판 좌표는 판 좌표(칸 x 0..w, z 0..d).
import * as THREE from '#three';
import { RoundedBoxGeometry } from '#three/addons/geometries/RoundedBoxGeometry.js';
import { footprint } from '../core/clues.js';
import { boardCenter, ISLAND_R } from '../core/layout.js';
import { cellStatus } from '../core/ghost.js';
import { key } from '../core/pieces.js';

const LIFT = 0.35; // 끄는 중 조각을 띄우는 높이
const FRAME_PAD = 0.35; // 판 칸 둘레 보라 틀 폭
const TRIM_PAD = 0.43; // 금테 폭
const SHAKE_TIME = 0.45; // 판 흔들기(초)
const PULSE_DT = 1 / 30; // 목표 모양 깜빡임만 있을 때 다시 그리는 간격(초)

const toColor = (c) => new THREE.Color(c);
const WRONG_COLOR = new THREE.Color('#FF5A5A'); // 목표 밖에 놓인 쌓기나무 색조
const WRONG_MIX = 0.72; // 조각 색에서 붉은색 쪽으로 섞는 비율(조각 색이 아직 알아볼 만큼만)

export function createWorld(renderer, scene, camera) {
  // 빛: 그림처럼 오른쪽 위에서 오는 따뜻한 빛
  scene.add(new THREE.HemisphereLight(0xfff4e0, 0xc9a57a, 1.15));
  const sun = new THREE.DirectionalLight(0xffe6c0, 2.3);
  sun.position.set(7, 14, -5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 40 });
  sun.shadow.bias = -0.0008;
  sun.shadow.radius = 4;
  scene.add(sun);

  // 그림 위에 그림자만 받는 투명 바닥
  const catcher = new THREE.Mesh(
    new THREE.CircleGeometry(ISLAND_R + 0.2, 64),
    new THREE.ShadowMaterial({ opacity: 0.28 }),
  );
  catcher.rotation.x = -Math.PI / 2;
  catcher.receiveShadow = true;
  scene.add(catcher);

  // 회전판 -> 흔들기 -> 판 좌표 그룹
  const turntable = new THREE.Group();
  scene.add(turntable);
  const shaker = new THREE.Group();
  turntable.add(shaker);
  const grid = new THREE.Group();
  shaker.add(grid);

  const frameMat = new THREE.MeshStandardMaterial({ color: 0x5a35b5, roughness: 0.45 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xf2b93b, metalness: 0.5, roughness: 0.35 });
  const tileMat = new THREE.MeshStandardMaterial({ color: 0xfff3d6, roughness: 0.7 });
  const frameGeo = new RoundedBoxGeometry(1 + 2 * FRAME_PAD, 0.16, 1 + 2 * FRAME_PAD, 3, 0.08);
  const trimGeo = new RoundedBoxGeometry(1 + 2 * TRIM_PAD, 0.08, 1 + 2 * TRIM_PAD, 3, 0.04);
  const tileGeo = new RoundedBoxGeometry(0.94, 0.06, 0.94, 2, 0.03);
  const ghostGeo = new RoundedBoxGeometry(0.92, 0.92, 0.92, 2, 0.08);
  const cubeGeo = new RoundedBoxGeometry(0.995, 0.995, 0.995, 2, 0.05);
  // 고르기 전용 보이지 않는 1x1x1 상자(쌓기나무 사이 아주 좁은 틈으로 광선이 빠지지 않게)
  const hitGeo = new THREE.BoxGeometry(1, 1, 1);
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const ghostMat = new THREE.MeshStandardMaterial({
    color: 0x8fefff, emissive: 0x2fc8f0, emissiveIntensity: 0.7,
    transparent: true, opacity: 0.45, depthWrite: false,
  });

  let dirty = true; // 다음 frame 에서 다시 그려야 한다(장면이 바뀜)

  // "앞" 표시
  const labelMesh = (() => {
    const cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = 128;
    const g = cv.getContext('2d');
    const draw = () => {
      g.clearRect(0, 0, 256, 128);
      g.fillStyle = '#F2B93B';
      g.beginPath();
      if (g.roundRect) g.roundRect(8, 8, 240, 112, 56);
      else g.rect(8, 8, 240, 112);
      g.fill();
      g.fillStyle = '#3A1E7A';
      g.font = 'bold 80px Pretendard, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('앞', 128, 70);
    };
    draw();
    const tex = new THREE.CanvasTexture(cv);
    // 글꼴(assets/fonts)이 늦게 오면 받은 뒤 다시 그린다.
    document.fonts?.load?.('bold 80px Pretendard', '앞').then(() => {
      draw();
      tex.needsUpdate = true;
      dirty = true;
    }).catch(() => {});
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 0.55),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }),
    );
    m.rotation.x = -Math.PI / 2;
    return m;
  })();

  const board = new THREE.Group();
  const ghost = new THREE.Group();
  grid.add(board, ghost);

  let center = { x: 0, z: 0 };
  let boardCells = new Set(); // 판 칸 "x,z"
  let entries = []; // {group, mat, wrongMat, sig, target:Vector3, bounce, cells, pos, lifted, cubes:[{m, c, wrong}]}
  let puzzleTarget = [];
  let ghostMeshes = new Map(); // 목표 칸 키 -> 반투명 칸 메시
  let ghostOn = false; // 1단계 단서(반투명 목표 모양)가 켜져 있다
  let time = 0;
  let shakeT = 0;

  const clear = (g) => { while (g.children.length) g.remove(g.children[0]); };

  // 판 = 목표 바닥(y=0) 칸 모양. 칸마다 틀·금테 상자를 겹쳐서 판 모양 그대로의 테두리를 만든다.
  function setPuzzle(target) {
    const fp = footprint(target);
    center = boardCenter(fp);
    boardCells = fp.cells;
    grid.position.set(-center.x, 0, -center.z);
    clear(board);
    clear(ghost);
    ghostMeshes = new Map();
    puzzleTarget = target;
    dirty = true;
    for (const k of fp.cells) {
      const [x, z] = k.split(',').map(Number);
      const fr = new THREE.Mesh(frameGeo, frameMat);
      fr.position.set(x + 0.5, 0, z + 0.5);
      fr.receiveShadow = true;
      fr.castShadow = true;
      const tr = new THREE.Mesh(trimGeo, trimMat);
      tr.position.set(x + 0.5, -0.04, z + 0.5);
      const tile = new THREE.Mesh(tileGeo, tileMat);
      tile.position.set(x + 0.5, 0.06, z + 0.5);
      tile.receiveShadow = true;
      board.add(fr, tr, tile);
    }
    labelMesh.position.set(center.x, 0.1, fp.d + 0.75);
    board.add(labelMesh);
    for (const [x, y, z] of target) {
      const m = new THREE.Mesh(ghostGeo, ghostMat);
      m.position.set(x + 0.5, y + 0.53, z + 0.5);
      ghost.add(m);
      ghostMeshes.set(key([x, y, z]), m);
    }
    updateMarks();
  }

  // 1단계 단서에서만: 목표 밖에 놓인 쌓기나무는 붉게, 이미 채운 목표 칸의 반투명 칸은 숨긴다.
  // 끄는 중 띄운 조각은 계산에서 뺀다(놓기 전에는 반투명 칸을 가리거나 붉게 칠하지 않는다).
  function updateMarks() {
    let wrongCells = new Set();
    let filled = new Set();
    if (ghostOn) {
      const placed = entries.map((e) => (e.lifted ? { cells: [], pos: e.pos } : { cells: e.cells, pos: e.pos }));
      ({ wrongCells, filledTargetCells: filled } = cellStatus(placed, puzzleTarget));
    }
    let changed = false;
    for (const e of entries) {
      for (const cube of e.cubes) {
        const wrong = ghostOn && !e.lifted
          && wrongCells.has(key([cube.c[0] + e.pos[0], cube.c[1] + e.pos[1], cube.c[2] + e.pos[2]]));
        if (wrong !== cube.wrong) {
          cube.wrong = wrong;
          cube.m.material = wrong ? e.wrongMat : e.mat;
          changed = true;
        }
      }
    }
    for (const [k, m] of ghostMeshes) {
      const show = !filled.has(k);
      if (m.visible !== show) { m.visible = show; changed = true; }
    }
    if (changed) dirty = true;
  }

  // 붉게 칠한 쌓기나무용 재질: 조각 색을 붉은색 쪽으로 섞고 약하게 빛나게 한다.
  function tintWrong(e) {
    e.wrongMat.color.copy(e.mat.color).lerp(WRONG_COLOR, WRONG_MIX);
  }

  const sigOf = (cells) => cells.map((c) => c.join(',')).join(';');

  function build(e, cells) {
    // 튀기기(눌렸다 펴지기)는 바닥 칸들의 가운데를 축으로 한다. pivot 을 그 점(y=0)에 두고
    // 칸 메시는 pivot 기준으로 놓아, 크기를 바꿔도 조각이 한쪽으로 밀리지 않게 한다.
    clear(e.group);
    e.pivot = new THREE.Group();
    const px = cells.reduce((sum, c) => sum + c[0] + 0.5, 0) / cells.length;
    const pz = cells.reduce((sum, c) => sum + c[2] + 0.5, 0) / cells.length;
    e.pivot.position.set(px, 0, pz);
    e.group.add(e.pivot);
    e.hits = [];
    e.cubes = [];
    e.cells = cells;
    for (const c of cells) {
      const m = new THREE.Mesh(cubeGeo, e.mat);
      m.position.set(c[0] + 0.5 - px, c[1] + 0.5, c[2] + 0.5 - pz);
      m.castShadow = true;
      m.receiveShadow = true;
      const h = new THREE.Mesh(hitGeo, hitMat);
      h.position.copy(m.position);
      h.userData.pieceIndex = e.index;
      e.pivot.add(m, h);
      e.hits.push(h);
      e.cubes.push({ m, c, wrong: false });
    }
    e.sig = sigOf(cells);
  }

  // pieces: [{cells, pos:[x,y,z], color}]
  function setPieces(pieces) {
    for (const e of entries) {
      grid.remove(e.group);
      e.mat.dispose();
      e.wrongMat.dispose();
    }
    dirty = true;
    entries = pieces.map((p, index) => {
      const e = {
        index,
        group: new THREE.Group(),
        mat: new THREE.MeshStandardMaterial({ color: toColor(p.color), roughness: 0.32 }),
        wrongMat: new THREE.MeshStandardMaterial({
          roughness: 0.32, emissive: 0xff1a1a, emissiveIntensity: 0.6,
        }),
        pos: [...p.pos],
        lifted: false,
        sig: '',
        target: new THREE.Vector3(...p.pos),
        bounce: 0,
      };
      tintWrong(e);
      build(e, p.cells);
      e.group.position.copy(e.target);
      grid.add(e.group);
      return e;
    });
    updateMarks();
  }

  // 조각 모양·위치를 바꾼다. lift 면 그 자리 위로 띄운다(끄는 중). 위치는 frame 에서 부드럽게 따라간다.
  function updatePiece(i, piece, { lift = false } = {}) {
    const e = entries[i];
    if (!e) return;
    if (sigOf(piece.cells) !== e.sig) build(e, piece.cells);
    if (piece.color !== undefined) { e.mat.color.set(piece.color); tintWrong(e); }
    e.pos = [...piece.pos];
    e.lifted = lift;
    e.target.set(piece.pos[0], piece.pos[1] + (lift ? LIFT : 0), piece.pos[2]);
    dirty = true;
    updateMarks();
  }

  const ray = new THREE.Raycaster();
  const ndcV = new THREE.Vector2();
  const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const aim = (ndc) => {
    scene.updateMatrixWorld();
    ndcV.set(ndc.x, ndc.y);
    ray.setFromCamera(ndcV, camera);
  };

  function pickPiece(ndc) {
    aim(ndc);
    const hit = ray.intersectObjects(entries.flatMap((e) => e.hits), false)[0];
    return hit ? hit.object.userData.pieceIndex : -1;
  }

  // 화면 점(ndc) 아래 조각과 맞은 점(판 좌표), 그 조각이 지금 그려진 자리(판 좌표, 움직이는 중이면 그 위치).
  // 끌기에서 잡은 점 = 맞은 점 − 그려진 자리. 없으면 null.
  function pickHit(ndc) {
    aim(ndc);
    const hit = ray.intersectObjects(entries.flatMap((e) => e.hits), false)[0];
    if (!hit) return null;
    const i = hit.object.userData.pieceIndex;
    const p = grid.worldToLocal(hit.point.clone());
    const g = entries[i].group.position;
    return { i, point: { x: p.x, y: p.y, z: p.z }, at: { x: g.x, y: g.y, z: g.z } };
  }

  // 화면 점(ndc) 광선이 판 좌표 높이 y 의 수평면과 만나는 점 {x, z}(판 좌표). 회전판·판 이동은 수평이라 높이는 그대로다.
  const level = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function planePoint(ndc, y) {
    aim(ndc);
    level.constant = -y;
    const v = new THREE.Vector3();
    if (!ray.ray.intersectPlane(level, v)) return null;
    grid.worldToLocal(v);
    return { x: v.x, z: v.z };
  }

  // 화면 점(ndc) 아래 바닥(y=0)의 판 좌표
  function floorPoint(ndc) {
    aim(ndc);
    const v = new THREE.Vector3();
    if (!ray.ray.intersectPlane(floor, v)) return null;
    grid.worldToLocal(v);
    return { x: v.x, z: v.z };
  }

  // 쌓기나무 하나하나가 화면에서 차지하는 사각형(꼭짓점 8개를 투영한 범위). 캔버스 기준 0..1 좌표.
  // pieces 의 판 좌표(움직이는 중 애니메이션 위치가 아니라 놓일 자리)를 쓴다. 돌리기 링 자리를 고를 때 쓴다.
  const corner = new THREE.Vector3();
  function cubeBoxes(pieces) {
    scene.updateMatrixWorld();
    const out = [];
    pieces.forEach((p, i) => {
      for (const c of p.cells) {
        let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
        for (let k = 0; k < 8; k++) {
          corner.set(p.pos[0] + c[0] + (k & 1), p.pos[1] + c[1] + ((k >> 1) & 1), p.pos[2] + c[2] + ((k >> 2) & 1));
          grid.localToWorld(corner).project(camera);
          const u = (corner.x + 1) / 2;
          const v = (1 - corner.y) / 2;
          l = Math.min(l, u); r = Math.max(r, u); t = Math.min(t, v); b = Math.max(b, v);
        }
        out.push({ i, l, t, r, b });
      }
    });
    return out;
  }

  // 그림자 켜기/끄기(저사양 모드)
  function setShadows(on) {
    dirty = true;
    renderer.shadowMap.enabled = on;
    sun.castShadow = on;
    catcher.visible = on;
    scene.traverse((o) => {
      if (!o.material) return;
      for (const m of [].concat(o.material)) m.needsUpdate = true;
    });
  }

  // 한 프레임 진행. 바뀐 것이 있을 때만 그린다.
  // -> 'motion'(조각이 움직이거나 튀거나 판이 흔들리거나 장면이 바뀌어 그림), 'pulse'(목표 모양 깜빡임만
  //    있어 1/30초마다 그림), null(그리지 않음)
  let lastPulse = -Infinity;
  function frame(dt = 1 / 60) {
    time += dt;
    let moving = shakeT > 0;
    const k = 1 - Math.pow(0.65, dt * 60); // 60fps 에서 한 프레임 0.35 만큼 따라감
    for (const e of entries) {
      if (e.group.position.distanceToSquared(e.target) > 1e-6) {
        e.group.position.lerp(e.target, k);
        moving = true;
      } else {
        e.group.position.copy(e.target);
      }
      if (e.bounce > 0) moving = true;
      if (e.bounce > 0) {
        e.bounce = Math.max(0, e.bounce - 0.08 * dt * 60);
        const s = 1 + Math.sin(e.bounce * Math.PI) * 0.06;
        e.pivot.scale.set(s, 1 / s, s);
      } else {
        e.pivot.scale.set(1, 1, 1);
      }
    }
    if (shakeT > 0) {
      shakeT = Math.max(0, shakeT - dt);
      const p = shakeT / SHAKE_TIME;
      shaker.position.x = Math.sin((1 - p) * Math.PI * 8) * 0.12 * p;
    } else {
      shaker.position.x = 0;
    }
    const pulsing = ghost.visible && ghost.children.some((m) => m.visible);
    let kind = null;
    if (dirty || moving) kind = 'motion';
    else if (pulsing && time - lastPulse >= PULSE_DT) kind = 'pulse';
    if (!kind) return null;
    if (pulsing) {
      ghostMat.opacity = 0.42 + Math.sin(time * 2.4) * 0.1;
      lastPulse = time;
    }
    dirty = false;
    renderer.render(scene, camera);
    return kind;
  }

  return {
    setPuzzle,
    setPieces,
    updatePiece,
    showGhost: (on) => { ghost.visible = !!on; ghostOn = !!on; updateMarks(); dirty = true; },
    // 확인용: 붉게 칠한 쌓기나무 수(조각별), 지금 보이는 반투명 칸 수
    wrongCubes: () => entries.map((e) => e.cubes.filter((c) => c.wrong).length),
    ghostShown: () => (ghost.visible ? ghost.children.filter((m) => m.visible).length : 0),
    setSpin: (rad) => { turntable.rotation.y = rad; dirty = true; },
    getSpin: () => turntable.rotation.y,
    pickPiece,
    pickHit,
    floorPoint,
    planePoint,
    cubeBoxes,
    bounce: (i) => { if (entries[i]) { entries[i].bounce = 1; dirty = true; } },
    shakeBoard: () => { shakeT = SHAKE_TIME; dirty = true; },
    stopShake: () => { shakeT = 0; shaker.position.x = 0; dirty = true; },
    // 다음 frame 에서 꼭 다시 그린다(크기 바뀜 등 장면 밖 변화)
    invalidate: () => { dirty = true; },
    setShadows,
    frame,
    // 판 좌표 -> 월드 좌표(화면 투영 등에 쓴다)
    toWorld: (x, y, z) => { scene.updateMatrixWorld(); return grid.localToWorld(new THREE.Vector3(x, y, z)); },
    center: () => ({ ...center }),
    // 판 칸 "x,z" 집합(돌리기가 판 밖 조각을 판 칸으로 들여보내지 않게 쓴다)
    board: () => boardCells,
    // 조각이 따라가는 목표 위치(판 좌표, 끄는 중이면 띄운 높이 포함). 확인용
    pieceTarget: (i) => (entries[i] ? entries[i].target.toArray() : null),
  };
}
