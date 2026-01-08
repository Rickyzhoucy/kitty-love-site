'use client';

import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';

// Live2D 模型动作类型
export type Live2DMotion = 'Idle' | 'Tap' | 'Shake' | 'Flick' | 'FlickUp' | 'FlickLeft' | 'Flick3';

export interface Live2DPetHandle {
    playMotion: (group: Live2DMotion) => void;
}

interface Live2DPetProps {
    modelPath: string;
    width?: number;
    height?: number;
    onLoad?: () => void;
    onError?: (error: Error) => void;
}

const Live2DPet = forwardRef<Live2DPetHandle, Live2DPetProps>(
    ({ modelPath, width = 200, height = 200, onLoad, onError }, ref) => {
        // 使用 div 容器而不是 canvas，让 Pixi 自己创建 canvas
        const containerRef = useRef<HTMLDivElement>(null);
        const appRef = useRef<any>(null);
        const modelRef = useRef<any>(null);

        useImperativeHandle(ref, () => ({
            playMotion: (group: Live2DMotion) => {
                if (modelRef.current) {
                    try {
                        modelRef.current.motion(group);
                    } catch (e) {
                        console.warn('Failed to play motion:', group, e);
                    }
                }
            }
        }));

        const isInitializingRef = useRef(false);

        useEffect(() => {
            let isMounted = true;

            const initLive2D = async () => {
                if (!containerRef.current || isInitializingRef.current) return;

                const checkGlobals = () => {
                    const PIXI = (window as any).PIXI;
                    const Live2DModel = PIXI?.live2d?.Live2DModel;
                    return { PIXI, Live2DModel };
                };

                let { PIXI, Live2DModel } = checkGlobals();
                let attempts = 0;
                while ((!PIXI || !Live2DModel) && isMounted && attempts < 50) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    ({ PIXI, Live2DModel } = checkGlobals());
                    attempts++;
                }

                if (!isMounted) return;

                if (!PIXI || !Live2DModel) {
                    console.error('PixiJS or Live2DModel global not found.');
                    return;
                }

                console.log('Live2DPet: Initializing with PIXI version:', PIXI.VERSION);
                isInitializingRef.current = true;

                try {
                    // 销毁旧实例
                    if (appRef.current) {
                        appRef.current.destroy(true);
                    }

                    // 清空容器
                    if (containerRef.current) {
                        containerRef.current.innerHTML = '';
                    }

                    // 创建 PIXI 应用 - 不传递 view，让 Pixi 内部创建 canvas
                    // 使用 backgroundAlpha: 0 实现透明背景
                    const app = new PIXI.Application({
                        width,
                        height,
                        backgroundAlpha: 0,
                        backgroundColor: 0x000000, // Fallback
                        antialias: false,
                        resolution: 1,
                        autoDensity: false,
                        hello: true
                    });
                    appRef.current = app;

                    // 将 Canvas 添加到 DOM
                    if (containerRef.current) {
                        containerRef.current.appendChild(app.view as HTMLCanvasElement);
                    }

                    // 加载 Live2D 模型
                    Live2DModel.from(modelPath, {
                        autoInteract: false,
                        autoUpdate: true,
                    }).then((model: any) => {
                        if (!isMounted) {
                            model.destroy();
                            return;
                        }

                        modelRef.current = model;

                        const scale = Math.min(width / model.width, height / model.height) * 0.9;
                        model.scale.set(scale);
                        model.x = width / 2;
                        model.y = height / 2;
                        model.anchor.set(0.5, 0.5);

                        app.stage.addChild(model);

                        try {
                            if (model.internalModel?.motionManager?.settings) {
                                (model.internalModel.motionManager.settings as any).idleMotionGroupName = 'Idle';
                            }
                        } catch { /* ignore */ }

                        onLoad?.();
                    }).catch((error: Error) => {
                        console.error('Failed to load Live2D model:', error);
                        onError?.(error);
                    });

                } catch (error) {
                    console.error('Failed to initialize PixiJS:', error);
                    onError?.(error as Error);
                }
            };

            initLive2D();

            return () => {
                isMounted = false;
                if (modelRef.current) {
                    try { modelRef.current.destroy(); } catch { }
                    modelRef.current = null;
                }
                if (appRef.current) {
                    try { appRef.current.destroy(true); } catch { }
                    appRef.current = null;
                }
                isInitializingRef.current = false;
            };
        }, [modelPath, width, height, onLoad, onError]);

        return (
            <div
                ref={containerRef}
                style={{
                    width: `${width}px`,
                    height: `${height}px`,
                    cursor: 'pointer',
                    // 确保容器可以点击
                    pointerEvents: 'auto'
                }}
            />
        );
    }
);

Live2DPet.displayName = 'Live2DPet';

export default Live2DPet;
