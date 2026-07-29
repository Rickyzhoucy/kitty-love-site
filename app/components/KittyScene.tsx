"use client";

import { Suspense, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF, Float, Environment, Center } from '@react-three/drei';
import * as THREE from 'three';

// Hello Kitty 模型
function KittyModel({ onClick, modelUrl, onReady }: { onClick: () => void; modelUrl?: string; onReady?: () => void }) {
    const groupRef = useRef<THREE.Group>(null!);
    const isDefault = !modelUrl;
    const url = modelUrl || '/models/a5319345f5e44408a7fde7a36cbd45dd.gltf';
    const { scene } = useGLTF(url);
    const readyRef = useRef(false);

    useFrame((state) => {
        if (!readyRef.current) {
            readyRef.current = true;
            onReady?.();
        }
        // 轻微浮动动画：默认模型基准 Y 为 -2，自定义模型居中为 0
        const baseY = isDefault ? -2 : 0;
        groupRef.current.position.y = baseY + Math.sin(state.clock.elapsedTime * 1.5) * 0.1;
        groupRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.5) * 0.1;
    });

    const content = <primitive object={scene} />;

    return (
        <Float speed={1.5} rotationIntensity={0.2} floatIntensity={0.3}>
            <group ref={groupRef} onClick={onClick} scale={1.5} position={isDefault ? [0, -10, 0] : [0, 0, 0]}>
                {isDefault ? content : <Center>{content}</Center>}
            </group>
        </Float>
    );
}

// 主场景
export default function KittyScene({ onKittyClick, modelUrl }: { onKittyClick: () => void; modelUrl?: string }) {
    const [ready, setReady] = useState(false);

    return (
        <div className="relative h-full w-full">
            {!ready && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 text-accent">
                    <span className="relative flex h-16 w-16 items-center justify-center">
                        <span className="animate-pulse-ring absolute inset-0 rounded-full border-2 border-accent/40" />
                        <span className="animate-pulse-ring absolute inset-2 rounded-full border border-accent/30 [animation-delay:0.4s]" />
                        <span className="text-2xl">🎀</span>
                    </span>
                    <span className="text-sm tracking-widest">召唤 Kitty 中</span>
                </div>
            )}
            <Canvas
                frameloop="always"
                dpr={[1, 2]}
                onCreated={({ gl, camera, size }) => {
                    // 容器尺寸在首帧前可能未就绪，显式同步尺寸与投影矩阵，防止白屏
                    gl.setSize(size.width, size.height, false);
                    camera.updateProjectionMatrix();
                }}
                camera={{ position: [0, -2, 5], fov: 45, near: 0.1, far: 100 }}
                style={{ background: 'transparent' }}
            >
                <ambientLight intensity={0.8} />
                <directionalLight position={[5, 5, 5]} intensity={1} color="#ffffff" />
                <directionalLight position={[-5, 5, -5]} intensity={0.5} color="#FFB6C1" />
                <pointLight position={[0, 3, 3]} intensity={0.5} color="#FFC0CB" />

                <Environment files="/sunset.hdr" />

                <Suspense fallback={null}>
                    <KittyModel onClick={onKittyClick} modelUrl={modelUrl} onReady={() => setReady(true)} />
                </Suspense>

                <OrbitControls
                    enableZoom={true}
                    minDistance={2}
                    maxDistance={8}
                    enablePan={false}
                    autoRotate
                    autoRotateSpeed={0.5}
                    maxPolarAngle={Math.PI / 1.5}
                    minPolarAngle={Math.PI / 4}
                />
            </Canvas>
        </div>
    );
}

// 预加载模型
useGLTF.preload('/models/a5319345f5e44408a7fde7a36cbd45dd.gltf');
