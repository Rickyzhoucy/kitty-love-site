'use client';

import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type PointerEvent as ReactPointerEvent,
    type RefObject,
} from 'react';
import type { PetFacing } from './petBodyProtocol';
import {
    clampToEnvironment,
    createDomEnvironmentProvider,
    type EnvironmentProvider,
} from './platform/environment';

interface PetPosition {
    right: number;
    bottom: number;
}

interface DragState {
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startRight: number;
    startBottom: number;
    moved: boolean;
}

interface UsePetInteractionOptions {
    bodyRef: RefObject<HTMLElement | null>;
    disabled?: boolean;
    onFacing: (facing: PetFacing) => void;
    onHeldChange: (held: boolean) => void;
    onWalkingChange: (walking: boolean) => void;
    onLand: () => void;
    onTap: (area: 'head' | 'body') => void;
    onOpenMenu: () => void;
    onInteraction: () => void;
    /**
     * 宠物尺寸的标识。变化时重新夹取位置。
     *
     * 不能只靠 EnvironmentProvider 的 resize 通知：那盯的是**窗口和 body**，
     * 宠物自己变大不会触发。放大到贴边的宠物如果不重新夹一次，就会有一半
     * 露在屏幕外。
     */
    sizeToken?: string | number;
    /**
     * 点页面空白处，宠物是否走过去。也就是菜单里那个「自由行动」。
     *
     * **桌面宠物窗口一律传 false。** 那个窗口是一块铺在桌面上的透明矩形，
     * 网页收不到窗口外的点击；桌面版的「点哪儿走哪儿」在 Rust 那边实现
     * （src-tauri/src/main.rs 的 spawn_roam_loop），走的是移动窗口。
     */
    clickToWalk?: boolean;
}

const DEFAULT_POSITION: PetPosition = { right: 20, bottom: 112 };
const STORAGE_KEY = 'companionPetPosition';
const WALK_SPEED_PX_PER_MS = 0.115;
const WALK_START_DELAY_MS = 160;
const MIN_WALK_DURATION_MS = 700;
const MAX_WALK_DURATION_MS = 7_600;
const WALK_EXCLUSION = [
    'button',
    'a',
    'input',
    'textarea',
    'select',
    'label',
    '[role="button"]',
    '[contenteditable="true"]',
    '[data-no-pet-walk]',
].join(',');

/** 底部导航的预留高度。Web 端特有，桌面端由 EnvironmentProvider 的工作区代替。 */
const BOTTOM_RESERVE = 88;

/** 模块级单例：每个宠物实例各建一套监听没有意义。 */
const DOM_ENVIRONMENT = createDomEnvironmentProvider();

/**
 * 把位置夹进可用区域并推离障碍物。
 *
 * 位置对外用 right/bottom 锚定（贴右下角更符合浮窗直觉），环境抽象用
 * left/top，所以这里来回换算一次。换算而不是改锚定方式，是因为 right/bottom
 * 让宠物在窗口缩放时自然保持在右下角，那个行为值得保留。
 */
function clampPosition(
    position: PetPosition,
    width: number,
    height: number,
    environment: EnvironmentProvider = DOM_ENVIRONMENT,
): PetPosition {
    const viewport = environment.viewport();
    const left = viewport.right - position.right - width;
    const top = viewport.bottom - position.bottom - height;
    const placed = clampToEnvironment(
        { left, top, right: left + width, bottom: top + height },
        environment,
    );
    return {
        right: Math.max(8, viewport.right - placed.x - width),
        bottom: Math.max(
            BOTTOM_RESERVE,
            Math.min(viewport.bottom - height - 8, viewport.bottom - placed.y - height),
        ),
    };
}

export function usePetInteraction({
    bodyRef,
    disabled = false,
    onFacing,
    onHeldChange,
    onWalkingChange,
    onLand,
    onTap,
    onOpenMenu,
    onInteraction,
    sizeToken,
    clickToWalk = true,
}: UsePetInteractionOptions) {
    const [position, setPosition] = useState<PetPosition>(() => {
        if (typeof window === 'undefined') return DEFAULT_POSITION;
        const saved = localStorage.getItem(STORAGE_KEY);
        if (!saved) return DEFAULT_POSITION;
        try {
            const parsed = JSON.parse(saved) as PetPosition;
            return Number.isFinite(parsed.right) && Number.isFinite(parsed.bottom)
                ? parsed
                : DEFAULT_POSITION;
        } catch {
            localStorage.removeItem(STORAGE_KEY);
            return DEFAULT_POSITION;
        }
    });
    const [moving, setMoving] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [travelMs, setTravelMs] = useState(0);
    const dragRef = useRef<DragState | null>(null);
    const movementStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const movementTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const stopMovement = useCallback((land = false) => {
        if (movementStartTimerRef.current) clearTimeout(movementStartTimerRef.current);
        if (movementTimerRef.current) clearTimeout(movementTimerRef.current);
        movementStartTimerRef.current = null;
        movementTimerRef.current = null;
        setMoving(false);
        onWalkingChange(false);
        if (land) onLand();
    }, [onLand, onWalkingChange]);

    useEffect(() => {
        if (disabled) return;
        return () => {
            if (movementStartTimerRef.current) clearTimeout(movementStartTimerRef.current);
            if (movementTimerRef.current) clearTimeout(movementTimerRef.current);
        };
    }, [disabled]);

    useEffect(() => {
        if (disabled) return;
        const handleResize = () => {
            const bounds = bodyRef.current?.getBoundingClientRect();
            setPosition(current => clampPosition(
                current,
                bounds?.width ?? 138,
                bounds?.height ?? 138,
            ));
        };
        // sizeToken 变化时立刻夹一次：宠物自己变大不会触发任何环境事件，
        // 不主动夹的话放大后会有一半露在屏幕外。
        handleResize();
        // 走 EnvironmentProvider 而不是直接监听 resize：桌面端的「环境变了」
        // 是显示器切换或 Dock 位置改变，DOM 里根本没有对应事件（实施计划 §9）。
        return DOM_ENVIRONMENT.subscribe(handleResize);
    }, [bodyRef, disabled, sizeToken]);

    useEffect(() => {
        if (disabled || !clickToWalk) return;
        const handlePageClick = (event: MouseEvent) => {
            const target = event.target;
            if (!(target instanceof Element) || event.button !== 0 || event.defaultPrevented) return;
            if (bodyRef.current?.contains(target) || target.closest(WALK_EXCLUSION)) return;
            if (window.getSelection()?.toString()) return;

            const bounds = bodyRef.current?.getBoundingClientRect();
            const width = bounds?.width ?? 138;
            const height = bounds?.height ?? 138;
            const currentCenterX = window.innerWidth - position.right - width / 2;
            const currentCenterY = window.innerHeight - position.bottom - height / 2;
            const next = clampPosition({
                right: window.innerWidth - event.clientX - width / 2,
                bottom: window.innerHeight - event.clientY - height * 0.12,
            }, width, height);
            const targetCenterX = window.innerWidth - next.right - width / 2;
            const targetCenterY = window.innerHeight - next.bottom - height / 2;
            const distance = Math.hypot(
                targetCenterX - currentCenterX,
                targetCenterY - currentCenterY,
            );
            const duration = Math.round(Math.max(
                MIN_WALK_DURATION_MS,
                Math.min(MAX_WALK_DURATION_MS, distance / WALK_SPEED_PX_PER_MS),
            ));

            stopMovement();
            onInteraction();
            onFacing(event.clientX >= currentCenterX ? 'right' : 'left');
            onWalkingChange(true);
            setTravelMs(duration);
            setMoving(true);
            movementStartTimerRef.current = setTimeout(() => {
                movementStartTimerRef.current = null;
                setPosition(next);
            }, WALK_START_DELAY_MS);
            movementTimerRef.current = setTimeout(() => {
                setMoving(false);
                onWalkingChange(false);
                onLand();
                localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            }, duration + WALK_START_DELAY_MS);
        };
        document.addEventListener('click', handlePageClick);
        return () => document.removeEventListener('click', handlePageClick);
    }, [
        bodyRef,
        clickToWalk,
        disabled,
        onFacing,
        onInteraction,
        onLand,
        onWalkingChange,
        position.bottom,
        position.right,
        stopMovement,
    ]);

    const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
        stopMovement();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = {
            pointerId: event.pointerId,
            startClientX: event.clientX,
            startClientY: event.clientY,
            startRight: position.right,
            startBottom: position.bottom,
            moved: false,
        };
        setDragging(true);
        onInteraction();
        onHeldChange(true);
    };

    const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const deltaX = event.clientX - drag.startClientX;
        const deltaY = event.clientY - drag.startClientY;
        if (Math.abs(deltaX) + Math.abs(deltaY) > 6) drag.moved = true;
        const size = event.currentTarget.getBoundingClientRect();
        setPosition(clampPosition({
            right: drag.startRight - deltaX,
            bottom: drag.startBottom - deltaY,
        }, size.width, size.height));
    };

    const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        dragRef.current = null;
        setDragging(false);
        onHeldChange(false);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(position));
        if (drag.moved) {
            onLand();
            return;
        }
        const bounds = event.currentTarget.getBoundingClientRect();
        onTap(event.clientY - bounds.top < bounds.height * 0.48 ? 'head' : 'body');
        onOpenMenu();
    };

    const onPointerCancel = () => {
        dragRef.current = null;
        setDragging(false);
        onHeldChange(false);
    };

    return {
        position,
        moving,
        travelMs,
        dragging,
        petButtonProps: {
            onPointerDown,
            onPointerMove,
            onPointerUp,
            onPointerCancel,
        },
    };
}
