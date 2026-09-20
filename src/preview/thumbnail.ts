import * as THREE from 'three';

/**
 * Render a small PNG of the given meshes for the printer's file browser.
 * Returns base64 (without the data: prefix).
 */
export function renderThumbnail(objects: THREE.Object3D[], width: number, height: number): string | undefined {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.setClearColor(0x1c2128, 1);
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(1, -1.2, 1.6);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5);
    fill.position.set(-1, 1, 0.5);
    scene.add(fill);

    const group = new THREE.Group();
    for (const o of objects) {
      const clone = o.clone(true);
      clone.traverse((c) => {
        const mesh = c as THREE.Mesh;
        if (mesh.isMesh) mesh.material = new THREE.MeshStandardMaterial({ color: 0x5ec26a, roughness: 0.55, metalness: 0.05 });
      });
      group.add(clone);
    }
    scene.add(group);
    const box = new THREE.Box3().setFromObject(group);
    if (box.isEmpty()) { renderer.dispose(); return undefined; }
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.85 + 1;
    const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 5000);
    const dir = new THREE.Vector3(1, -1.1, 0.8).normalize();
    const dist = radius / Math.tan((camera.fov * Math.PI) / 360);
    camera.position.copy(center).addScaledVector(dir, dist);
    camera.up.set(0, 0, 1);
    camera.lookAt(center);
    renderer.render(scene, camera);
    const dataUrl = canvas.toDataURL('image/png');
    renderer.dispose();
    return dataUrl.split(',')[1];
  } catch {
    return undefined;
  }
}
