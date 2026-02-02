# Direct-to-R2 Uploads Design

## Problem

The webapp was failing on 750MB+ video uploads because the free tier only has 2GB RAM. The old upload flow buffered the entire file in server memory before uploading to R2.

## Solution

Implement direct-to-R2 uploads using presigned URLs. The video never passes through the server's memory.

## Architecture

```
Old Flow (memory-limited):
Browser → POST /api/upload → Server (buffers in RAM) → R2

New Flow (memory-free):
Browser → GET /api/upload/initiate → Server → {presigned_url, storage_key}
Browser → PUT {presigned_url} → R2 (direct)
Browser → POST /api/upload/complete → Server → verify exists
```

## API Endpoints

### GET /api/upload/initiate

Generate a presigned PUT URL for direct R2 upload.

**Query Parameters:**
- `filename` (str): Original filename
- `size_bytes` (int): File size for validation

**Response:**
```json
{
  "storage_key": "uploads/abc123_video.mov",
  "upload_url": "https://...r2.cloudflarestorage.com/...",
  "expires_in": 3600
}
```

### POST /api/upload/complete

Verify that a direct upload completed successfully.

**Request Body:**
```json
{
  "storage_key": "uploads/abc123_video.mov"
}
```

**Response:**
```json
{
  "storage_key": "uploads/abc123_video.mov",
  "size_bytes": 800946180,
  "verified": true
}
```

## CORS Configuration

R2 bucket requires CORS rules for browser uploads:

```json
{
  "rules": [{
    "allowed": {
      "methods": ["GET", "PUT", "HEAD"],
      "origins": [
        "http://localhost:5173",
        "http://localhost:3000",
        "https://golfclip.vercel.app"
      ],
      "headers": ["content-type", "content-length"]
    },
    "exposeHeaders": ["ETag", "Content-Length"],
    "maxAgeSeconds": 3600
  }]
}
```

Configured via: `wrangler r2 bucket cors set golf-clip --file cors-rules.json`

## Frontend Changes

`VideoDropzone.tsx` updated to:

1. Call `/api/upload/initiate` to get presigned URL
2. Upload directly to R2 via XHR PUT (for progress events)
3. Call `/api/upload/complete` to verify
4. Return storage_key to continue processing

Progress is tracked via `xhr.upload.onprogress` (0-95% for upload, 96-100% for verification).

## Test Script Changes

`compare_performance.py` updated to use direct upload for webapp tests:

1. GET presigned URL
2. Stream file to R2 with progress callback
3. Verify upload

## Benefits

| Metric | Old Flow | New Flow |
|--------|----------|----------|
| Max file size | ~1.5GB (2GB RAM) | Unlimited |
| Server memory | O(file_size) | O(1) |
| Upload speed | Limited by server | Direct to R2 |

## Future: Multipart Uploads

For files >5GB or unreliable networks, implement multipart:

```
GET /api/upload/initiate?multipart=true
→ {upload_id, storage_key, part_urls: [...]}

# Upload parts in parallel
PUT part_urls[0], PUT part_urls[1], ...

POST /api/upload/complete
Body: {storage_key, upload_id, parts: [{etag, part_number}, ...]}
```

This is not implemented yet but the API is designed to support it.

## Files Changed

- `apps/webapp/backend/core/storage.py` - Added `get_presigned_upload_url()`, `get_object_size()`, `generate_storage_key()`
- `apps/webapp/backend/api/routes.py` - Added `/upload/initiate` and `/upload/complete` endpoints
- `apps/webapp/cors-rules.json` - R2 CORS configuration
- `packages/frontend/src/components/VideoDropzone.tsx` - Direct upload with progress
- `scripts/compare_performance.py` - Updated webapp upload method
