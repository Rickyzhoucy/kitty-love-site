"use client";

import { Suspense, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF, Float, Environment } from '@react-three/drei';
import * as THREE from 'three';

// Hello Kitty Model Component
function KittyModel({ onClick }: { onClick: () => void }) {
    const groupRef = useRef<THREE.Group>(null!);
    const { scene } = useGLTF('/models/a5319345f5e44408a7fde7a36cbd45dd.gltf');

    useFrame((state) => {
        // Gentle floating animation
        groupRef.current.position.y = Math.sin(state.clock.elapsedTime * 1.5) * 0.1;
        groupRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.5) * 0.1;
    });

    return (
        <Float speed={1.5} rotationIntensity={0.2} floatIntensity={0.3}>
            <group ref={groupRef} onClick={onClick} scale={1.5} position={[0, -10, 0]}>
                <primitive object={scene} />
            </group>
        </Float>
    );
}

// Loading Component
function LoadingFallback() {
    return (
        <mesh>
            <sphereGeometry args={[0.5, 16, 16]} />
            <meshStandardMaterial color="#F48FB1" />
        </mesh>
    );
}

// Main 3D Scene
export default function KittyScene({ onKittyClick }: { onKittyClick: () => void }) {
    return (
        <Canvas
            camera={{ position: [0, 0, 5], fov: 45 }}
            style={{ background: 'transparent' }}
        >
            {/* Lighting */}
            <ambientLight intensity={0.8} />
            <directionalLight position={[5, 5, 5]} intensity={1} color="#ffffff" />
            <directionalLight position={[-5, 5, -5]} intensity={0.5} color="#FFB6C1" />
            <pointLight position={[0, 3, 3]} intensity={0.5} color="#FFC0CB" />

            {/* Environment for better reflections */}
            <Environment preset="sunset" />

            {/* Model */}
            <Suspense fallback={<LoadingFallback />}>
                <KittyModel onClick={onKittyClick} />
            </Suspense>

            {/* Camera Controls */}
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
    );
}

// Preload the model
useGLTF.preload('/models/a5319345f5e44408a7fde7a36cbd45dd.gltf');
