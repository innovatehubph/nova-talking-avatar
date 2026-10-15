import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import Avatar, { type AvatarState } from "./Avatar";

interface Props {
  state: AvatarState;
  mouth: React.MutableRefObject<number>;
  size?: number;
}

// 3D robot avatar: loads the generated GLB and drives it procedurally —
// idle float + breathing, cursor tracking, listening lean, and
// squash-and-stretch bounce driven by speech amplitude while talking.
// Falls back to the 2D canvas avatar if the model can't load.
export default function RobotAvatar({ state, mouth, size = 360 }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const mount = mountRef.current!;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(0, 0.6, 4.2);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(size, size);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    // Lighting: key violet, cool fill, rim
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(2, 3, 4);
    scene.add(key);
    const violet = new THREE.PointLight(0x7b2eff, 12, 10);
    violet.position.set(-2.5, 1.5, 2.5);
    scene.add(violet);
    const rim = new THREE.DirectionalLight(0x8f4bff, 0.8);
    rim.position.set(0, 2, -3);
    scene.add(rim);

    const pointer = { x: 0, y: 0 };
    const onMove = (e: PointerEvent) => {
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove);

    const root = new THREE.Group();
    scene.add(root);

    const loader = new GLTFLoader();
    loader.load(
      "/robot.glb",
      (gltf) => {
        const model = gltf.scene;
        // normalize to ~2 units tall, centered
        const box = new THREE.Box3().setFromObject(model);
        const dim = box.getSize(new THREE.Vector3());
        const scale = 2.1 / Math.max(dim.x, dim.y, dim.z);
        model.scale.setScalar(scale);
        const box2 = new THREE.Box3().setFromObject(model);
        const center = box2.getCenter(new THREE.Vector3());
        model.position.sub(center);
        root.add(model);
      },
      undefined,
      () => setFailed(true)
    );

    const clock = new THREE.Clock();
    let raf = 0;
    const animate = () => {
      const t = clock.getElapsedTime();
      const s = stateRef.current;
      const amp = Math.min(1, mouth.current); // 0..1 speech amplitude

      // idle float + breathing
      root.position.y = Math.sin(t * 1.4) * 0.05;
      const breathe = 1 + Math.sin(t * 1.8) * 0.008;

      // speaking: squash & stretch with amplitude
      const squash = 1 + amp * 0.12 * Math.sin(t * 14);
      root.scale.set(breathe / Math.sqrt(squash), breathe * squash, breathe / Math.sqrt(squash));

      // cursor tracking (lean toward pointer); listening: attentive tilt
      const targetRotY = pointer.x * 0.45;
      const targetRotX = pointer.y * 0.2 + (s === "listening" ? -0.08 : 0);
      root.rotation.y += (targetRotY - root.rotation.y) * 0.06;
      root.rotation.x += (targetRotX - root.rotation.x) * 0.06;

      // thinking: gentle side-to-side sway; speaking: lively wiggle
      if (s === "thinking") root.rotation.z = Math.sin(t * 2.5) * 0.05;
      else if (s === "speaking") root.rotation.z = Math.sin(t * 8) * 0.03 * (0.3 + amp);
      else root.rotation.z *= 0.95;

      // violet light pulses with state
      violet.intensity =
        s === "listening" ? 12 + Math.sin(t * 5) * 6 :
        s === "speaking" ? 12 + amp * 10 : 10;

      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [mouth, size]);

  if (failed) return <Avatar state={state} mouth={mouth} size={size} />;
  return <div ref={mountRef} style={{ width: size, height: size }} aria-label="3D AI robot avatar" />;
}
