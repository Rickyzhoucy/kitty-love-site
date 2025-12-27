import COS from 'cos-nodejs-sdk-v5';

// Initialize COS client only if credentials are present
const getCosClient = () => {
    if (!process.env.COS_SECRET_ID || !process.env.COS_SECRET_KEY || !process.env.COS_BUCKET || !process.env.COS_REGION) {
        return null;
    }

    return new COS({
        SecretId: process.env.COS_SECRET_ID,
        SecretKey: process.env.COS_SECRET_KEY,
    });
};

export async function uploadToCos(buffer: Buffer, filename: string, contentType: string = 'application/octet-stream'): Promise<string> {
    const cos = getCosClient();

    if (!cos) {
        throw new Error('COS credentials not configured');
    }

    const bucket = process.env.COS_BUCKET!;
    const region = process.env.COS_REGION!;
    // Optional: Add a path prefix like 'uploads/'
    const key = `uploads/${filename}`;

    return new Promise((resolve, reject) => {
        cos.putObject({
            Bucket: bucket,
            Region: region,
            Key: key,
            Body: buffer,
            ContentType: contentType, // Important for browser to display images correctly
        }, (err: any, data: any) => {
            if (err) {
                console.error('COS Upload Error:', err);
                return reject(err);
            }

            // Construct the URL. Prefer HTTPS.
            // Format: https://<BucketName>-<AppId>.cos.<Region>.myqcloud.com/<Key>
            // We can rely on Location from response or construct it manually.
            // data.Location usually looks like: bucket-appid.cos.region.myqcloud.com/key
            const protocol = 'https://';
            const location = data.Location;

            // Ensure URL starts with protocol
            const url = location.startsWith('http') ? location : `${protocol}${location}`;

            resolve(url);
        });
    });
}
