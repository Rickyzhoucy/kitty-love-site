import { api } from './client';

/**
 * 表情包。
 *
 * **各存各的，但看得见对方的**——`mine` 决定面板里能不能删。归属是服务端
 * 规则，不是前端藏个按钮就算数（见 backend/app/stickers.py）。
 */
export interface Sticker {
    id: string;
    createdAt: string;
    ownerId: string;
    attachmentId: string;
    /** 已经是可用地址，指向原图而非缩略图——缩略图是静态 webp，GIF 不会动。 */
    url: string;
    contentType: string;
    mine: boolean;
}

export function listStickers(): Promise<Sticker[]> {
    return api.get<Sticker[]>('/stickers');
}

export function saveSticker(attachmentId: string): Promise<Sticker> {
    return api.post<Sticker>('/stickers', { attachmentId });
}

export function deleteSticker(id: string): Promise<void> {
    return api.delete<void>(`/stickers/${id}`);
}

/** 把选中的挪到最前。抄微信：没有拖拽，只有「移到最前」。 */
export function moveStickersToFront(stickerIds: string[]): Promise<void> {
    return api.post<void>('/stickers/reorder', { stickerIds });
}
