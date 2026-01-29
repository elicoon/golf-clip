"""Cloudflare R2 storage backend."""

import uuid
from pathlib import Path
from typing import Optional

import boto3
from botocore.exceptions import ClientError
from loguru import logger

from backend.core.config import settings


class R2Storage:
    """Cloudflare R2 storage (S3-compatible)."""

    def __init__(self):
        self.bucket_name = settings.r2_bucket
        self.endpoint_url = f"https://{settings.r2_account_id}.r2.cloudflarestorage.com"

        self.client = boto3.client(
            "s3",
            endpoint_url=self.endpoint_url,
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
            region_name="auto",
        )
        logger.info(f"R2Storage initialized for bucket {self.bucket_name}")

    def upload(self, content: bytes, filename: str, prefix: str = "uploads") -> str:
        """Upload content and return storage key."""
        unique_id = str(uuid.uuid4())[:8]
        key = f"{prefix}/{unique_id}_{filename}"

        self.client.put_object(
            Bucket=self.bucket_name,
            Key=key,
            Body=content,
        )
        logger.debug(f"Uploaded {len(content)} bytes to {key}")
        return key

    def upload_file(self, file_path: Path, prefix: str = "uploads") -> str:
        """Upload file from disk."""
        unique_id = str(uuid.uuid4())[:8]
        key = f"{prefix}/{unique_id}_{file_path.name}"

        self.client.upload_file(str(file_path), self.bucket_name, key)
        logger.debug(f"Uploaded file {file_path} to {key}")
        return key

    def download(self, key: str) -> bytes:
        """Download content by key."""
        response = self.client.get_object(Bucket=self.bucket_name, Key=key)
        return response["Body"].read()

    def download_to_file(self, key: str, destination: Path) -> Path:
        """Download to local file."""
        destination.parent.mkdir(parents=True, exist_ok=True)
        self.client.download_file(self.bucket_name, key, str(destination))
        return destination

    def delete(self, key: str) -> None:
        """Delete by key."""
        self.client.delete_object(Bucket=self.bucket_name, Key=key)
        logger.debug(f"Deleted {key}")

    def get_presigned_url(self, key: str, expires_in: int = 3600) -> str:
        """Get presigned URL for direct access."""
        return self.client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket_name, "Key": key},
            ExpiresIn=expires_in,
        )

    def exists(self, key: str) -> bool:
        """Check if key exists."""
        try:
            self.client.head_object(Bucket=self.bucket_name, Key=key)
            return True
        except ClientError:
            return False

    def get_presigned_upload_url(self, key: str, expires_in: int = 3600) -> str:
        """Get presigned URL for direct upload (PUT)."""
        return self.client.generate_presigned_url(
            "put_object",
            Params={"Bucket": self.bucket_name, "Key": key},
            ExpiresIn=expires_in,
        )

    def get_object_size(self, key: str) -> int | None:
        """Get object size in bytes, or None if not found."""
        try:
            response = self.client.head_object(Bucket=self.bucket_name, Key=key)
            return response["ContentLength"]
        except ClientError:
            return None

    def generate_storage_key(self, filename: str, prefix: str = "uploads") -> str:
        """Generate a unique storage key for a file."""
        unique_id = str(uuid.uuid4())[:8]
        return f"{prefix}/{unique_id}_{filename}"


_storage: Optional[R2Storage] = None


def get_storage() -> R2Storage:
    """Get singleton storage instance."""
    global _storage
    if _storage is None:
        _storage = R2Storage()
    return _storage
