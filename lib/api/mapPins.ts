'use client';

import { api } from './client';

/**
 * 恋爱地图（计划文档 §2.5）。
 *
 * 坐标是 **GCJ-02**（高德原生）。存什么读什么，这一层刻意不做任何转换——
 * 转换逻辑写在哪一侧都迟早会漏一处，然后点就偏出去几百米。
 */

export interface MapPin {
    id: string;
    createdAt: string;
    createdBy: string | null;
    title: string;
    /** GCJ-02 纬度 */
    lat: number;
    /** GCJ-02 经度 */
    lng: number;
    note: string | null;
    date: string | null;
    photoIds: string[];
}

export interface MapPinInput {
    title: string;
    lat: number;
    lng: number;
    note?: string | null;
    date?: string | null;
    photoIds?: string[];
}

export const mapPinsApi = {
    list: () => api.get<MapPin[]>('/map-pins'),
    create: (data: MapPinInput) => api.post<MapPin>('/map-pins', data),
    update: (id: string, data: Partial<MapPinInput>) =>
        api.patch<MapPin>(`/map-pins/${encodeURIComponent(id)}`, data),
    remove: (id: string) => api.delete<void>(`/map-pins/${encodeURIComponent(id)}`),
};
