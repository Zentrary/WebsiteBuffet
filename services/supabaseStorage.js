const crypto = require('crypto');

const BUCKET = 'buffet-uploads';
const MAX_BYTES = 5 * 1024 * 1024;
const EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

let bucketReady = false;

function isConfigured() {
  return Boolean(
    String(process.env.SUPABASE_URL || '').trim() &&
      String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  );
}

function projectBase() {
  return String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
}

function authHeaders(extra = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return {
    Authorization: `Bearer ${key}`,
    apikey: key,
    ...extra,
  };
}

function publicObjectUrl(objectPath) {
  const safePath = String(objectPath || '').replace(/^\/+/, '');
  return `${projectBase()}/storage/v1/object/public/${BUCKET}/${safePath}`;
}

async function ensureBucket() {
  if (bucketReady || !isConfigured()) return;
  const response = await fetch(`${projectBase()}/storage/v1/bucket`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      id: BUCKET,
      name: BUCKET,
      public: true,
      file_size_limit: MAX_BYTES,
      allowed_mime_types: Object.keys(EXTENSIONS),
    }),
  });
  if (response.ok || response.status === 409 || response.status === 400) {
    bucketReady = true;
    return;
  }
  const text = await response.text().catch(() => '');
  if (/already exists|duplicate/i.test(text)) {
    bucketReady = true;
    return;
  }
  const error = new Error(
    `ไม่สามารถเตรียมที่เก็บรูป Supabase Storage ได้ (${response.status})`
  );
  error.code = 'UPLOAD_STORAGE_UNAVAILABLE';
  error.status = 503;
  error.detail = text.slice(0, 300);
  throw error;
}

async function uploadBuffer({ buffer, contentType, folder = 'misc' }) {
  if (!isConfigured()) {
    const error = new Error('ยังไม่ได้ตั้งค่า Supabase Storage');
    error.code = 'UPLOAD_STORAGE_UNAVAILABLE';
    error.status = 501;
    throw error;
  }
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    const error = new Error('ไม่พบไฟล์รูปภาพ');
    error.code = 'INVALID_IMAGE';
    error.status = 400;
    throw error;
  }
  if (buffer.length > MAX_BYTES) {
    const error = new Error('ไฟล์ใหญ่เกิน 5 MB');
    error.code = 'INVALID_IMAGE';
    error.status = 400;
    throw error;
  }
  const extension = EXTENSIONS[contentType];
  if (!extension) {
    const error = new Error('รองรับเฉพาะ JPG, PNG, WEBP หรือ GIF');
    error.code = 'INVALID_IMAGE';
    error.status = 400;
    throw error;
  }

  await ensureBucket();
  const safeFolder =
    String(folder || 'misc')
      .replace(/[^a-z0-9/_-]/gi, '')
      .replace(/^\/+|\/+$/g, '') || 'misc';
  const objectPath = `${safeFolder}/${crypto.randomUUID()}${extension}`;
  const response = await fetch(
    `${projectBase()}/storage/v1/object/${BUCKET}/${objectPath}`,
    {
      method: 'POST',
      headers: authHeaders({
        'Content-Type': contentType,
        'x-upsert': 'true',
        'cache-control': 'public, max-age=31536000',
      }),
      body: buffer,
    }
  );
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const error = new Error('อัปโหลดรูปไปยัง Supabase Storage ไม่สำเร็จ');
    error.code = 'UPLOAD_FAILED';
    error.status = 502;
    error.detail = text.slice(0, 300);
    console.error('Supabase Storage upload failed:', response.status, error.detail);
    throw error;
  }
  return {
    imageUrl: publicObjectUrl(objectPath),
    path: objectPath,
    bucket: BUCKET,
  };
}

module.exports = {
  BUCKET,
  EXTENSIONS,
  MAX_BYTES,
  isConfigured,
  publicObjectUrl,
  uploadBuffer,
  ensureBucket,
};
