// 3D 장면: 빛, 그림자 전용 바닥, 회전판, 판(보라 틀 + 금테 + 크림 칸 + "앞" 표시), 목표 모양, 조각 메시.
// 카메라는 calibrate.js 로 그림 시점에 고정하고, 화면을 돌리면 회전판 그룹만 Y축으로 돈다.
// 판 중심이 월드 원점이다(grid 그룹을 판 중심만큼 거꾸로 옮긴다). 조각·판 좌표는 판 좌표(칸 x 0..w, z 0..d).
import * as THREE from '#three';
import { RoundedBoxGeometry } from '#three/addons/geometries/RoundedBoxGeometry.js';
import { footprint } from '../core/clues.js';
import { boardCenter, ISLAND_R } from '../core/layout.js';

const LIFT = 0.35; // 끄는 중 조각을 띄우는 높이
const FRAME_PAD = 0.35; // 판 칸 둘레 보라 틀 폭
const TRIM_PAD = 0.43; // 금테 폭
const SHAKE_TIME = 0.45; // 판 흔들기(초)
const PULSE_DT = 1 / 30; // 목표 모양 깜빡임만 있을 때 다시 그리는 간격(초)

const toColor = (c) => new THREE.Color(c);

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
  let entries = []; // {group, mat, sig, target:Vector3, bounce}
  let time = 0;
  let shakeT = 0;

  const clear = (g) => { while (g.children.length) g.remove(g.children[0]); };

  // 판 = 목표 바닥(y=0) 칸 모양. 칸마다 틀·금테 상자를 겹쳐서 판 모양 그대로의 테두리를 만든다.
  function setPuzzle(target) {
    const fp = footprint(target);
    center = boardCenter(fp);
    grid.position.set(-center.x, 0, -center.z);
    clear(board);
    clear(ghost);
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
    }
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
    }
    e.sig = sigOf(cells);
  }

  // pieces: [{cells, pos:[x,y,z], color}]
  function setPieces(pieces) {
    for (const e of entries) {
      grid.remove(e.group);
      e.mat.dispose();
    }
    dirty = true;
    entries = pieces.map((p, index) => {
      const e = {
        index,
        group: new THREE.Group(),
        mat: new THREE.MeshStandardMaterial({ color: toColor(p.color), roughness: 0.32 }),
        sig: '',
        target: new THREE.Vector3(...p.pos),
        bounce: 0,
      };
      build(e, p.cells);
      e.group.position.copy(e.target);
      grid.add(e.group);
      return e;
    });
  }

  // 조각 모양·위치를 바꾼다. lift 면 그 자리 위로 띄운다(끄는 중). 위치는 frame 에서 부드럽게 따라간다.
  function updatePiece(i, piece, { lift = false } = {}) {
    const e = entries[i];
    if (!e) return;
    if (sigOf(piece.cells) !== e.sig) build(e, piece.cells);
    if (piece.color !== undefined) e.mat.color.set(piece.color);
    e.target.set(piece.pos[0], piece.pos[1] + (lift ? LIFT : 0), piece.pos[2]);
    dirty = true;
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

  // 화면 점(ndc) 아래 바닥(y=0)의 판 좌표
  function floorPoint(ndc) {
    aim(ndc);
    const v = new THREE.Vector3();
    if (!ray.ray.intersectPlane(floor, v)) return null;
    grid.worldToLocal(v);
    return { x: v.x, z: v.z };
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
    const pulsing = ghost.visible && ghost.children.length > 0;
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
    showGhost: (on) => { ghost.visible = !!on; dirty = true; },
    setSpin: (rad) => { turntable.rotation.y = rad; dirty = true; },
    getSpin: () => turntable.rotation.y,
    pickPiece,
    floorPoint,
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
    // 조각이 따라가는 목표 위치(판 좌표, 끄는 중이면 띄운 높이 포함). 확인용
    pieceTarget: (i) => (entries[i] ? entries[i].target.toArray() : null),
  };
}
