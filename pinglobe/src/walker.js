import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import mapboxgl from 'mapbox-gl';

/**
 * Adds an animated walking figure near the North Pole.
 * Renders the GLB model on its own canvas, displayed as a Mapbox marker.
 */
export function addWalker(map) {
  const size = 120; // canvas resolution
  const display = 80; // CSS display size

  // Create a separate canvas for Three.js (NOT sharing Mapbox's GL context)
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const el = document.createElement('div');
  el.className = 'walker-marker';
  el.style.width = display + 'px';
  el.style.height = display + 'px';
  el.style.pointerEvents = 'none';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  el.appendChild(canvas);

  // Three.js setup — own renderer, own context
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setSize(size, size);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 1.2, 3.5);
  camera.lookAt(0, 0.6, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 1.0));
  const dir = new THREE.DirectionalLight(0xffffff, 1.5);
  dir.position.set(2, 3, 2);
  scene.add(dir);

  let mixer;
  const clock = new THREE.Clock();

  new GLTFLoader().load('/walker.glb', (gltf) => {
    scene.add(gltf.scene);

    if (gltf.animations.length) {
      mixer = new THREE.AnimationMixer(gltf.scene);
      const action = mixer.clipAction(gltf.animations[0]);
      action.setLoop(THREE.LoopRepeat);
      action.play();
    }

    function animate() {
      requestAnimationFrame(animate);
      if (mixer) mixer.update(clock.getDelta());
      renderer.render(scene, camera);
    }
    animate();
  }, undefined, (err) => {
    console.warn('Walker model failed to load:', err);
  });

  // Place as a Mapbox marker pinned to the North Pole area
  new mapboxgl.Marker({ element: el, anchor: 'bottom' })
    .setLngLat([0, 83])
    .addTo(map);
}
