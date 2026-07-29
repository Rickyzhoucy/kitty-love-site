'use client';

import { useEffect, useRef } from 'react';
import { subscribeServerEvent, type ResourceChangedEvent } from './events';

function singular(value: string): string {
    return value.toLowerCase().replace(/s$/, '');
}

/**
 * 资源发生服务端变更时重新同步页面数据。
 * callback 使用 ref 保存，避免每次渲染重建 SSE 订阅。
 */
export function useResourceEvents(resources: string[], callback: (event: ResourceChangedEvent) => void) {
    const callbackRef = useRef(callback);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const resourceKey = resources.map(singular).sort().join(',');

    useEffect(() => {
        callbackRef.current = callback;
    }, [callback]);

    useEffect(() => {
        const accepted = new Set(resourceKey.split(',').filter(Boolean));
        const unsubscribe = subscribeServerEvent<ResourceChangedEvent>('resource.changed', event => {
            if (accepted.has(singular(event.resource))) {
                if (debounceRef.current) clearTimeout(debounceRef.current);
                debounceRef.current = setTimeout(() => callbackRef.current(event), 100);
            }
        });
        return () => {
            unsubscribe();
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = null;
        };
    }, [resourceKey]);
}
