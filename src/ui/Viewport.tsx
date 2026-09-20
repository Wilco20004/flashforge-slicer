import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { PlateObject } from './model';
import { worldMatrix } from './model';
import type { PreviewData } from '../slicer/gcode';
import { PATH_TYPES, PATH_TYPE_COLOR } from '../slicer/plan';

export interface ViewportProps {
  objects: PlateObject[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  mode: 'prepare' | 'preview';
  preview: PreviewData | null;
  visibleLayers: number; // number of layers shown in preview mode
  showTravel: boolean;
  bedX: number;
  bedY: number;
  maxZ: number;
  outOfBounds: Set<string>;
  onDropFiles: (files: FileList) => void;
}

interface SceneRefs {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  objectGroup: THREE.Group;
  previewGroup: THREE.Group;
  bedGroup: THREE.Group;
  raycaster: THREE.Raycaster;
  meshes: Map<string, THREE.Mesh>;
  extrusion?: { lines: THREE.LineSegments; layerOffsets: Uint32Array };
  travel?: { lines: THREE.LineSegments; layerOffsets: Uint32Array };
}

const TRAVEL_INDEX = PATH_TYPES.indexOf('travel');

export function Viewport(props: ViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const refs = useRef<SceneRefs | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  // ---- one-time scene setup ----
  useEffect(() => {
    const el = containerRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x14181f, 1);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 1, 5000);
    camera.up.set(0, 0, 1);
    camera.position.set(190, -260, 200);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 30);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.maxPolarAngle = Math.PI * 0.55;
    controls.update();

    scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(200, -300, 400);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5);
    fill.position.set(-300, 200, 200);
    scene.add(fill);

    const bedGroup = new THREE.Group();
    const objectGroup = new THREE.Group();
    const previewGroup = new THREE.Group();
    scene.add(bedGroup, objectGroup, previewGroup);

    const r: SceneRefs = { renderer, scene, camera, controls, objectGroup, previewGroup, bedGroup, raycaster: new THREE.Raycaster(), meshes: new Map() };
    refs.current = r;

    const resize = () => {
      const w = el.clientWidth || 1, h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    let raf = 0;
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();

    // click selection (ignore drags)
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) { down = null; return; }
      down = null;
      if (propsRef.current.mode !== 'prepare') return;
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      r.raycaster.setFromCamera(ndc, camera);
      const hits = r.raycaster.intersectObjects(objectGroup.children, false);
      propsRef.current.onSelect(hits.length ? (hits[0].object.userData.id as string) : null);
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    const onDragOver = (e: DragEvent) => { e.preventDefault(); };
    const onDrop = (e: DragEvent) => { e.preventDefault(); if (e.dataTransfer?.files?.length) propsRef.current.onDropFiles(e.dataTransfer.files); };
    el.addEventListener('dragover', onDragOver);
    el.addEventListener('drop', onDrop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      el.removeEventListener('dragover', onDragOver);
      el.removeEventListener('drop', onDrop);
      controls.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      refs.current = null;
    };
  }, []);

  // ---- bed ----
  useEffect(() => {
    const r = refs.current; if (!r) return;
    r.bedGroup.clear();
    const { bedX, bedY, maxZ } = props;
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(bedX, bedY),
      new THREE.MeshStandardMaterial({ color: 0x2a3140, roughness: 0.9, metalness: 0.0 }),
    );
    plate.position.z = -0.05;
    plate.userData.bed = true;
    r.bedGroup.add(plate);
    const grid = new THREE.GridHelper(Math.max(bedX, bedY), Math.max(bedX, bedY) / 10, 0x5c6b80, 0x3a4453);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = 0.01;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.6;
    r.bedGroup.add(grid);
    // volume outline
    const box = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(bedX, bedY, maxZ)),
      new THREE.LineBasicMaterial({ color: 0x3f4c5e, transparent: true, opacity: 0.5 }),
    );
    box.position.z = maxZ / 2;
    r.bedGroup.add(box);
    // front edge marker + axes
    const front = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-bedX / 2, -bedY / 2, 0.02), new THREE.Vector3(bedX / 2, -bedY / 2, 0.02)]),
      new THREE.LineBasicMaterial({ color: 0x5ec26a }),
    );
    r.bedGroup.add(front);
    const axes = new THREE.AxesHelper(20);
    axes.position.set(-bedX / 2, -bedY / 2, 0.05);
    r.bedGroup.add(axes);
  }, [props.bedX, props.bedY, props.maxZ]);

  // ---- objects ----
  useEffect(() => {
    const r = refs.current; if (!r) return;
    const seen = new Set<string>();
    for (const o of props.objects) {
      seen.add(o.id);
      let mesh = r.meshes.get(o.id);
      if (!mesh) {
        mesh = new THREE.Mesh(o.geometry, new THREE.MeshStandardMaterial({ color: 0x5ec26a, roughness: 0.6, metalness: 0.05 }));
        mesh.matrixAutoUpdate = false;
        mesh.userData.id = o.id;
        r.meshes.set(o.id, mesh);
        r.objectGroup.add(mesh);
      }
      if (mesh.geometry !== o.geometry) mesh.geometry = o.geometry;
      mesh.matrix.copy(worldMatrix(o));
      mesh.matrixWorldNeedsUpdate = true;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const selected = o.id === props.selectedId;
      const oob = props.outOfBounds.has(o.id);
      mat.color.set(oob ? 0xe0554f : selected ? 0x8fe39a : 0x5ec26a);
      mat.emissive.set(selected ? 0x1d4a24 : 0x000000);
    }
    for (const [id, mesh] of r.meshes) {
      if (!seen.has(id)) { r.objectGroup.remove(mesh); r.meshes.delete(id); }
    }
    r.objectGroup.visible = props.mode === 'prepare';
  }, [props.objects, props.selectedId, props.mode, props.outOfBounds]);

  // ---- preview geometry ----
  useEffect(() => {
    const r = refs.current; if (!r) return;
    r.previewGroup.clear();
    r.extrusion = undefined;
    r.travel = undefined;
    const p = props.preview;
    if (!p) return;
    const layerCount = p.layerOffsets.length - 1;
    const build = (travel: boolean) => {
      const count = countType(p.types, travel);
      const pos = new Float32Array(count * 6);
      const col = new Float32Array(count * 6);
      const offsets = new Uint32Array(layerCount + 1);
      const colors = PATH_TYPES.map((t) => new THREE.Color(PATH_TYPE_COLOR[t]));
      let k = 0;
      for (let L = 0; L < layerCount; L++) {
        offsets[L] = k;
        for (let i = p.layerOffsets[L]; i < p.layerOffsets[L + 1]; i++) {
          const isTravel = p.types[i] === TRAVEL_INDEX;
          if (isTravel !== travel) continue;
          pos.set(p.segments.subarray(i * 6, i * 6 + 6), k * 6);
          const c = colors[p.types[i]];
          col[k * 6] = c.r; col[k * 6 + 1] = c.g; col[k * 6 + 2] = c.b;
          col[k * 6 + 3] = c.r; col[k * 6 + 4] = c.g; col[k * 6 + 5] = c.b;
          k++;
        }
      }
      offsets[layerCount] = k;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: travel, opacity: travel ? 0.35 : 1 }));
      lines.frustumCulled = false;
      return { lines, layerOffsets: offsets };
    };
    r.extrusion = build(false);
    r.travel = build(true);
    r.previewGroup.add(r.extrusion.lines, r.travel.lines);
  }, [props.preview]);

  useEffect(() => {
    const r = refs.current; if (!r) return;
    r.previewGroup.visible = props.mode === 'preview';
    const n = props.visibleLayers;
    if (r.extrusion) r.extrusion.lines.geometry.setDrawRange(0, r.extrusion.layerOffsets[Math.min(n, r.extrusion.layerOffsets.length - 1)] * 2);
    if (r.travel) {
      r.travel.lines.visible = props.showTravel;
      r.travel.lines.geometry.setDrawRange(0, r.travel.layerOffsets[Math.min(n, r.travel.layerOffsets.length - 1)] * 2);
    }
  }, [props.mode, props.visibleLayers, props.showTravel, props.preview]);

  return <div ref={containerRef} className="viewport" />;
}

function countType(types: Uint8Array, travel: boolean): number {
  let c = 0;
  for (let i = 0; i < types.length; i++) if ((types[i] === TRAVEL_INDEX) === travel) c++;
  return c;
}
