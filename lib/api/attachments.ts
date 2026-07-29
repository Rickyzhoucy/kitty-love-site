import { ApiError, api } from './client';

export interface Attachment {
    id: string;
    bucket: string;
    objectKey: string;
    filename: string;
    contentType: string;
    size: number;
    sha256: string;
    status: string;
    parseStatus: 'pending' | 'ready' | 'unsupported' | 'failed';
    parseError?: string | null;
    versionId?: string | null;
    downloadUrl: string;
    thumbnailUrl?: string | null;
    createdAt: string;
}

interface PresignedUpload {
    bucket: string;
    objectKey: string;
    uploadUrl: string;
    expiresIn: number;
}

/**
 * 文件先直传 MinIO，再通知领域服务完成入库。
 * 预签名 URL 不携带站点 Cookie，避免跨源上传触发无关凭据校验。
 */
export async function uploadAttachment(file: File): Promise<Attachment> {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const request = {
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        size: file.size,
        sha256,
    };
    const presigned = await api.post<PresignedUpload>('/attachments/presign', request);

    let uploadResponse: Response;
    try {
        uploadResponse = await fetch(presigned.uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': request.contentType },
            body: file,
        });
    } catch (error) {
        throw new ApiError(0, '文件上传失败，请检查对象存储服务', error);
    }
    if (!uploadResponse.ok) {
        throw new ApiError(uploadResponse.status, `文件上传失败（${uploadResponse.status}）`);
    }

    let attachment = await api.post<Attachment>('/attachments/complete', {
        ...request,
        bucket: presigned.bucket,
        objectKey: presigned.objectKey,
    });
    if (!request.contentType.startsWith('image/') && !request.contentType.startsWith('text/')) {
        for (let attempt = 0; attempt < 120 && attachment.parseStatus === 'pending'; attempt += 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
            attachment = await api.get<Attachment>(`/attachments/${attachment.id}`);
        }
        if (attachment.parseStatus === 'failed') {
            throw new ApiError(422, attachment.parseError || '文件解析失败');
        }
        if (attachment.parseStatus === 'pending') {
            throw new ApiError(425, '文件仍在解析，请稍后再发送');
        }
    }
    return attachment;
}
