import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { uploadToCos } from '@/app/utils/cos';

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
        }

        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);

        // Create unique filename
        const timestamp = Date.now();
        const originalName = file.name.replace(/\s+/g, '-');
        const filename = `${timestamp}-${originalName}`;

        // Determine Storage Type
        const storageType = process.env.STORAGE_TYPE || 'local';

        let url = '';

        if (storageType === 'cos') {
            // Upload to Tencent Cloud COS
            try {
                // Determine content type
                const ext = originalName.split('.').pop()?.toLowerCase();
                let contentType = 'application/octet-stream';
                if (ext === 'jpg' || ext === 'jpeg') contentType = 'image/jpeg';
                else if (ext === 'png') contentType = 'image/png';
                else if (ext === 'gif') contentType = 'image/gif';
                else if (ext === 'webp') contentType = 'image/webp';
                else if (ext === 'glb') contentType = 'model/gltf-binary';

                url = await uploadToCos(buffer, filename, contentType);
            } catch (error) {
                console.error('COS Upload failed:', error);
                return NextResponse.json({ error: 'Cloud storage upload failed' }, { status: 500 });
            }
        } else {
            // Local Storage (Default)
            // Ensure uploads directory exists
            const uploadDir = join(process.cwd(), 'public', 'uploads');
            try {
                await mkdir(uploadDir, { recursive: true });
            } catch (e) {
                // Directory might already exist
            }

            const filepath = join(uploadDir, filename);
            await writeFile(filepath, buffer);

            // Return the public URL
            url = `/uploads/${filename}`;
        }

        return NextResponse.json({ url, filename }, { status: 201 });
    } catch (error) {
        console.error('Upload error:', error);
        return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
    }
}
