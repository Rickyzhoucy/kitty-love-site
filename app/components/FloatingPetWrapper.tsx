'use client';

import dynamic from 'next/dynamic';

const FloatingPet = dynamic(
    () => import('./FloatingPet/FloatingPet'),
    { ssr: false }
);

export default function FloatingPetWrapper() {
    return <FloatingPet />;
}
