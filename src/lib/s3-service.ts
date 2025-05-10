import { RawFile, S3ListResponse } from '@/types';

// Client-side services using our API routes instead of direct S3 access

export async function listRawFiles(
  prefix: string = '',
  continuationToken?: string,
  maxKeys: number = 50
): Promise<S3ListResponse> {
  try {
    const params = new URLSearchParams();
    if (prefix) params.append('prefix', prefix);
    if (continuationToken) params.append('continuationToken', continuationToken);
    if (maxKeys) params.append('maxKeys', maxKeys.toString());

    const response = await fetch(`/api/s3/list?${params.toString()}`);

    if (!response.ok) {
      throw new Error(`Failed to list files: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error listing files:', error);
    throw error;
  }
}

export async function getRawFileSignedUrl(key: string): Promise<string> {
  try {
    const params = new URLSearchParams({ key });
    const response = await fetch(`/api/s3/file?${params.toString()}`);

    if (!response.ok) {
      throw new Error(`Failed to get file URL: ${response.statusText}`);
    }

    const data = await response.json();
    return data.url;
  } catch (error) {
    console.error('Error getting file URL:', error);
    throw error;
  }
}
