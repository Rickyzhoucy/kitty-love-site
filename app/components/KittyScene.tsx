"use client";

import { useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, Stars, OrbitControls, Html } from '@react-three/drei';
import * as THREE from 'three';

// Interactive Hello Kitty Character
function HelloKitty({ onPartClick }: { onPartClick: (part: string) => void }) {
    const groupRef = useRef<THREE.Group>(null!);
    const headRef = useRef<THREE.Group>(null!);
    const bowRef = useRef<THREE.Group>(null!);
    const leftPawRef = useRef<THREE.Mesh>(null!);
    const rightPawRef = useRef<THREE.Mesh>(null!);

    const [headBounce, setHeadBounce] = useState(0);
    const [bowSpin, setBowSpin] = useState(0);
    const [leftWave, setLeftWave] = useState(0);
    const [rightWave, setRightWave] = useState(0);

    // Breathing animation
    useFrame((state) => {
        const t = state.clock.elapsedTime;
        groupRef.current.position.y = Math.sin(t * 1.5) * 0.1;
        groupRef.current.rotation.y = Math.sin(t * 0.5) * 0.1;

        // Head tilt animation
        if (headBounce > 0) {
            headRef.current.rotation.z = Math.sin(headBounce * 10) * 0.2;
            setHeadBounce(prev => Math.max(0, prev - 0.02));
        } else {
            headRef.current.rotation.z = Math.sin(t * 2) * 0.05;
        }

        // Bow spin animation
        if (bowSpin > 0) {
            bowRef.current.rotation.y += 0.3;
            setBowSpin(prev => Math.max(0, prev - 0.02));
        }

        // Paw wave animations
        if (leftWave > 0) {
            leftPawRef.current.rotation.z = Math.sin(leftWave * 15) * 0.5 - 0.3;
            setLeftWave(prev => Math.max(0, prev - 0.02));
        } else {
            leftPawRef.current.rotation.z = -0.3;
        }

        if (rightWave > 0) {
            rightPawRef.current.rotation.z = Math.sin(rightWave * 15) * 0.5 + 0.3;
            setRightWave(prev => Math.max(0, prev - 0.02));
        } else {
            rightPawRef.current.rotation.z = 0.3;
        }
    });

    const handlePartClick = (part: string) => {
        onPartClick(part);
        switch (part) {
            case 'head':
                setHeadBounce(1);
                break;
            case 'bow':
                setBowSpin(1);
                break;
            case 'leftPaw':
                setLeftWave(1);
                break;
            case 'rightPaw':
                setRightWave(1);
                break;
        }
    };

    return (
        <Float speed={0.5} rotationIntensity={0.1} floatIntensity={0.3}>
            <group ref={groupRef} scale={1.5}>
                {/* HEAD */}
                <group ref={headRef} position={[0, 1.2, 0]} onClick={() => handlePartClick('head')}>
                    {/* Main head - oval shape */}
                    <mesh>
                        <sphereGeometry args={[1.2, 32, 32]} />
                        <meshStandardMaterial color="#FFFFFF" />
                    </mesh>

                    {/* Left ear */}
                    <mesh position={[-0.7, 0.8, 0]} rotation={[0, 0, -0.3]}>
                        <coneGeometry args={[0.4, 0.6, 32]} />
                        <meshStandardMaterial color="#FFFFFF" />
                    </mesh>

                    {/* Right ear */}
                    <mesh position={[0.7, 0.8, 0]} rotation={[0, 0, 0.3]}>
                        <coneGeometry args={[0.4, 0.6, 32]} />
                        <meshStandardMaterial color="#FFFFFF" />
                    </mesh>

                    {/* Left eye */}
                    <mesh position={[-0.35, 0.1, 1]}>
                        <sphereGeometry args={[0.12, 16, 16]} />
                        <meshStandardMaterial color="#000000" />
                    </mesh>

                    {/* Right eye */}
                    <mesh position={[0.35, 0.1, 1]}>
                        <sphereGeometry args={[0.12, 16, 16]} />
                        <meshStandardMaterial color="#000000" />
                    </mesh>

                    {/* Nose */}
                    <mesh position={[0, -0.1, 1.1]}>
                        <sphereGeometry args={[0.1, 16, 16]} />
                        <meshStandardMaterial color="#FFD700" />
                    </mesh>

                    {/* Left whiskers */}
                    <mesh position={[-0.6, -0.1, 0.9]} rotation={[0, 0, 0.1]}>
                        <boxGeometry args={[0.4, 0.02, 0.02]} />
                        <meshStandardMaterial color="#333333" />
                    </mesh>
                    <mesh position={[-0.6, -0.2, 0.9]} rotation={[0, 0, 0]}>
                        <boxGeometry args={[0.4, 0.02, 0.02]} />
                        <meshStandardMaterial color="#333333" />
                    </mesh>
                    <mesh position={[-0.6, -0.3, 0.9]} rotation={[0, 0, -0.1]}>
                        <boxGeometry args={[0.4, 0.02, 0.02]} />
                        <meshStandardMaterial color="#333333" />
                    </mesh>

                    {/* Right whiskers */}
                    <mesh position={[0.6, -0.1, 0.9]} rotation={[0, 0, -0.1]}>
                        <boxGeometry args={[0.4, 0.02, 0.02]} />
                        <meshStandardMaterial color="#333333" />
                    </mesh>
                    <mesh position={[0.6, -0.2, 0.9]} rotation={[0, 0, 0]}>
                        <boxGeometry args={[0.4, 0.02, 0.02]} />
                        <meshStandardMaterial color="#333333" />
                    </mesh>
                    <mesh position={[0.6, -0.3, 0.9]} rotation={[0, 0, 0.1]}>
                        <boxGeometry args={[0.4, 0.02, 0.02]} />
                        <meshStandardMaterial color="#333333" />
                    </mesh>

                    {/* BOW on left ear */}
                    <group ref={bowRef} position={[-0.9, 1, 0]} onClick={(e) => { e.stopPropagation(); handlePartClick('bow'); }}>
                        {/* Left loop */}
                        <mesh position={[-0.2, 0.1, 0]} rotation={[0, 0, 0.3]}>
                            <torusGeometry args={[0.18, 0.08, 16, 32]} />
                            <meshStandardMaterial color="#FF1493" />
                        </mesh>
                        {/* Right loop */}
                        <mesh position={[0.2, 0.1, 0]} rotation={[0, 0, -0.3]}>
                            <torusGeometry args={[0.18, 0.08, 16, 32]} />
                            <meshStandardMaterial color="#FF1493" />
                        </mesh>
                        {/* Center knot */}
                        <mesh position={[0, 0.1, 0]}>
                            <sphereGeometry args={[0.1, 16, 16]} />
                            <meshStandardMaterial color="#FF69B4" />
                        </mesh>
                    </group>
                </group>

                {/* BODY */}
                <mesh position={[0, -0.3, 0]}>
                    <capsuleGeometry args={[0.7, 0.8, 16, 32]} />
                    <meshStandardMaterial color="#FF69B4" /> {/* Pink outfit */}
                </mesh>

                {/* LEFT PAW */}
                <mesh
                    ref={leftPawRef}
                    position={[-0.9, 0, 0.3]}
                    onClick={(e) => { e.stopPropagation(); handlePartClick('leftPaw'); }}
                >
                    <sphereGeometry args={[0.3, 16, 16]} />
                    <meshStandardMaterial color="#FFFFFF" />
                </mesh>

                {/* RIGHT PAW */}
                <mesh
                    ref={rightPawRef}
                    position={[0.9, 0, 0.3]}
                    onClick={(e) => { e.stopPropagation(); handlePartClick('rightPaw'); }}
                >
                    <sphereGeometry args={[0.3, 16, 16]} />
                    <meshStandardMaterial color="#FFFFFF" />
                </mesh>

                {/* FEET */}
                <mesh position={[-0.4, -1.2, 0.2]}>
                    <sphereGeometry args={[0.25, 16, 16]} />
                    <meshStandardMaterial color="#FFFFFF" />
                </mesh>
                <mesh position={[0.4, -1.2, 0.2]}>
                    <sphereGeometry args={[0.25, 16, 16]} />
                    <meshStandardMaterial color="#FFFFFF" />
                </mesh>
            </group>
        </Float>
    );
}

// Floating decorative hearts
function FloatingHeart({ position, color, scale = 1 }: { position: [number, number, number], color: string, scale?: number }) {
    const mesh = useRef<THREE.Mesh>(null!);

    useFrame((state, delta) => {
        mesh.current.rotation.y += delta * 0.5;
    });

    const heartShape = new THREE.Shape();
    const x = 0, y = 0;
    heartShape.moveTo(x + 0.25, y + 0.25);
    heartShape.bezierCurveTo(x + 0.25, y + 0.25, x + 0.2, y, x, y);
    heartShape.bezierCurveTo(x - 0.3, y, x - 0.3, y + 0.35, x - 0.3, y + 0.35);
    heartShape.bezierCurveTo(x - 0.3, y + 0.55, x - 0.1, y + 0.77, x + 0.25, y + 0.95);
    heartShape.bezierCurveTo(x + 0.6, y + 0.77, x + 0.8, y + 0.55, x + 0.8, y + 0.35);
    heartShape.bezierCurveTo(x + 0.8, y + 0.35, x + 0.8, y, x + 0.5, y);
    heartShape.bezierCurveTo(x + 0.35, y, x + 0.25, y + 0.25, x + 0.25, y + 0.25);

    return (
        <Float speed={2} rotationIntensity={0.5} floatIntensity={2}>
            <mesh ref={mesh} position={position} scale={scale}>
                <extrudeGeometry args={[heartShape, { depth: 0.1, bevelEnabled: true, bevelSegments: 2, steps: 2, bevelSize: 0.03, bevelThickness: 0.03 }]} />
                <meshStandardMaterial color={color} />
            </mesh>
        </Float>
    );
}

// Main 3D Scene
export default function KittyScene({ onPartClick }: { onPartClick: (part: string) => void }) {
    return (
        <Canvas camera={{ position: [0, 0, 6], fov: 50 }}>
            <color attach="background" args={['#E0F7FA']} />

            {/* Lighting */}
            <ambientLight intensity={0.7} />
            <pointLight position={[10, 10, 10]} intensity={1} color="#FFB6C1" />
            <pointLight position={[-10, -10, -10]} intensity={0.5} color="#87CEEB" />
            <spotLight position={[0, 10, 5]} angle={0.3} penumbra={1} intensity={0.8} color="#FFC0CB" />

            {/* Stars background */}
            <Stars radius={50} depth={50} count={800} factor={4} saturation={0} fade speed={1} />

            {/* Hello Kitty Character */}
            <HelloKitty onPartClick={onPartClick} />

            {/* Floating Hearts Decoration */}
            <FloatingHeart position={[-3, 2, -2]} color="#FFB6C1" scale={0.5} />
            <FloatingHeart position={[3, -1, -3]} color="#F48FB1" scale={0.4} />
            <FloatingHeart position={[-2, -2, -1]} color="#FF69B4" scale={0.3} />
            <FloatingHeart position={[2.5, 2.5, -2]} color="#FFB6C1" scale={0.45} />

            {/* Camera controls */}
            <OrbitControls
                enableZoom={true}
                minDistance={4}
                maxDistance={10}
                enablePan={false}
                autoRotate
                autoRotateSpeed={0.3}
                maxPolarAngle={Math.PI / 1.5}
                minPolarAngle={Math.PI / 3}
            />
        </Canvas>
    );
}
