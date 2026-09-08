use std::{
    fs,
    io::Cursor,
    path::{Path, PathBuf},
};

use base64::{engine::general_purpose::STANDARD, Engine};
use image::{DynamicImage, ImageFormat};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageMetadata {
    pub width: u32,
    pub height: u32,
    pub byte_size: usize,
    pub thumbnail_path: String,
}

#[derive(Debug)]
pub struct StoredImage {
    pub file_path: String,
    pub metadata: String,
    pub content_hash: String,
}

#[derive(Debug, thiserror::Error)]
pub enum ImageServiceError {
    #[error("image file error: {0}")]
    Io(#[from] std::io::Error),
    #[error("image format error: {0}")]
    Image(#[from] image::ImageError),
    #[error("image metadata error: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, Clone)]
pub struct ImageService {
    images_directory: PathBuf,
    thumbnails_directory: PathBuf,
    collection_images_directory: PathBuf,
    collection_thumbnails_directory: PathBuf,
}

impl ImageService {
    pub fn initialize(directory: impl AsRef<Path>) -> Result<Self, ImageServiceError> {
        let images_directory = directory.as_ref().to_path_buf();
        let thumbnails_directory = images_directory.join("thumbnails");
        let collection_images_directory = images_directory.join("collections");
        let collection_thumbnails_directory = collection_images_directory.join("thumbnails");
        fs::create_dir_all(&thumbnails_directory)?;
        fs::create_dir_all(&collection_thumbnails_directory)?;
        Ok(Self {
            images_directory,
            thumbnails_directory,
            collection_images_directory,
            collection_thumbnails_directory,
        })
    }

    pub fn store_bitmap(&self, id: &str, bitmap: &[u8]) -> Result<StoredImage, ImageServiceError> {
        let image = image::load_from_memory_with_format(bitmap, ImageFormat::Bmp)?;
        self.store_image(id, image)
    }

    pub fn bitmap_for_clipboard(&self, file_path: &str) -> Result<Vec<u8>, ImageServiceError> {
        let image = image::open(file_path)?;
        encode(&image, ImageFormat::Bmp)
    }

    pub fn clone_for_collection(
        &self,
        id: &str,
        source_file_path: &str,
    ) -> Result<StoredImage, ImageServiceError> {
        let source_path = Path::new(source_file_path);
        if !source_path.starts_with(&self.images_directory) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "image path is outside the managed directory",
            )
            .into());
        }
        let image = image::open(source_path)?;
        self.store_image_in(
            id,
            image,
            &self.collection_images_directory,
            &self.collection_thumbnails_directory,
        )
    }

    pub fn data_url(&self, file_path: &str) -> Result<String, ImageServiceError> {
        let path = Path::new(file_path);
        if !path.starts_with(&self.images_directory) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "image path is outside the managed directory",
            )
            .into());
        }
        Ok(format!(
            "data:image/png;base64,{}",
            STANDARD.encode(fs::read(path)?)
        ))
    }

    pub fn remove_item_files(&self, file_path: Option<&str>, metadata: Option<&str>) {
        if let Some(path) = file_path {
            self.remove_managed_file(Path::new(path));
        }
        if let Some(metadata) =
            metadata.and_then(|value| serde_json::from_str::<ImageMetadata>(value).ok())
        {
            self.remove_managed_file(Path::new(&metadata.thumbnail_path));
        }
    }

    fn store_image(&self, id: &str, image: DynamicImage) -> Result<StoredImage, ImageServiceError> {
        self.store_image_in(
            id,
            image,
            &self.images_directory,
            &self.thumbnails_directory,
        )
    }

    fn store_image_in(
        &self,
        id: &str,
        image: DynamicImage,
        images_directory: &Path,
        thumbnails_directory: &Path,
    ) -> Result<StoredImage, ImageServiceError> {
        let rgba = image.to_rgba8();
        let mut hasher = Sha256::new();
        hasher.update(image.width().to_le_bytes());
        hasher.update(image.height().to_le_bytes());
        hasher.update(rgba.as_raw());
        let content_hash = hex::encode(hasher.finalize());

        let png = encode(&image, ImageFormat::Png)?;
        let thumbnail = image.thumbnail(320, 200);
        let thumbnail_png = encode(&thumbnail, ImageFormat::Png)?;
        let file_path = images_directory.join(format!("{id}.png"));
        let thumbnail_path = thumbnails_directory.join(format!("{id}.png"));
        if let Err(error) = fs::write(&file_path, &png) {
            return Err(error.into());
        }
        if let Err(error) = fs::write(&thumbnail_path, thumbnail_png) {
            let _ = fs::remove_file(&file_path);
            return Err(error.into());
        }

        let metadata = ImageMetadata {
            width: image.width(),
            height: image.height(),
            byte_size: png.len(),
            thumbnail_path: thumbnail_path.to_string_lossy().into_owned(),
        };
        Ok(StoredImage {
            file_path: file_path.to_string_lossy().into_owned(),
            metadata: serde_json::to_string(&metadata)?,
            content_hash,
        })
    }

    fn remove_managed_file(&self, path: &Path) {
        if path.starts_with(&self.images_directory) {
            let _ = fs::remove_file(path);
        }
    }
}

fn encode(image: &DynamicImage, format: ImageFormat) -> Result<Vec<u8>, ImageServiceError> {
    let mut cursor = Cursor::new(Vec::new());
    image.write_to(&mut cursor, format)?;
    Ok(cursor.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};

    #[test]
    fn stores_png_and_thumbnail_from_bitmap() {
        let directory = tempfile::tempdir().unwrap();
        let service = ImageService::initialize(directory.path().join("images")).unwrap();
        let source =
            DynamicImage::ImageRgba8(RgbaImage::from_pixel(640, 480, Rgba([40, 80, 120, 255])));
        let bitmap = encode(&source, ImageFormat::Bmp).unwrap();

        let stored = service.store_bitmap("sample", &bitmap).unwrap();
        let metadata: ImageMetadata = serde_json::from_str(&stored.metadata).unwrap();
        assert_eq!((metadata.width, metadata.height), (640, 480));
        assert!(Path::new(&stored.file_path).exists());
        assert!(Path::new(&metadata.thumbnail_path).exists());

        service.remove_item_files(Some(&stored.file_path), Some(&stored.metadata));
        assert!(!Path::new(&stored.file_path).exists());
        assert!(!Path::new(&metadata.thumbnail_path).exists());
    }
}
