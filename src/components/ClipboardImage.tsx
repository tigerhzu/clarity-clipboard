import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { getStoredImage } from "../lib/clipboard-api";
import type { ItemStorage } from "../types/clipboard";

interface ClipboardImageProps {
  id: string;
  thumbnail?: boolean;
  alt: string;
  sourcePath?: string;
  storage?: ItemStorage;
}

interface ImageState {
  cacheKey: string;
  source: string | null;
}

const MAX_CACHED_IMAGES = 80;
const MAX_CACHED_CHARACTERS = 32 * 1024 * 1024;
const imageCache = new Map<string, string>();
const pendingImages = new Map<string, Promise<string>>();
let cachedCharacterCount = 0;

function makeCacheKey(
  id: string,
  thumbnail: boolean,
  sourcePath: string | undefined,
  storage: ItemStorage,
): string {
  return `${storage}:${thumbnail ? "thumbnail" : "full"}:${id}:${sourcePath ?? ""}`;
}

function readCachedImage(cacheKey: string): string | null {
  return imageCache.get(cacheKey) ?? null;
}

function removeCachedImage(cacheKey: string): void {
  const source = imageCache.get(cacheKey);
  if (source === undefined) return;
  cachedCharacterCount -= source.length;
  imageCache.delete(cacheKey);
}

function cacheImage(cacheKey: string, source: string): void {
  removeCachedImage(cacheKey);

  // Very large full-size images are displayed through the asset protocol and
  // are deliberately not retained as duplicate base64 strings.
  if (source.length > MAX_CACHED_CHARACTERS) return;

  while (
    imageCache.size >= MAX_CACHED_IMAGES
    || cachedCharacterCount + source.length > MAX_CACHED_CHARACTERS
  ) {
    const oldestKey = imageCache.keys().next().value;
    if (oldestKey === undefined) break;
    removeCachedImage(oldestKey);
  }

  imageCache.set(cacheKey, source);
  cachedCharacterCount += source.length;
}

function loadImage(
  id: string,
  thumbnail: boolean,
  cacheKey: string,
  storage: ItemStorage,
): Promise<string> {
  const cached = readCachedImage(cacheKey);
  if (cached !== null) return Promise.resolve(cached);

  const pending = pendingImages.get(cacheKey);
  if (pending) return pending;

  const request = getStoredImage(storage, id, thumbnail)
    .then((source) => {
      if (!source) throw new Error("Clipboard image data was empty");
      cacheImage(cacheKey, source);
      return source;
    })
    .finally(() => pendingImages.delete(cacheKey));
  pendingImages.set(cacheKey, request);
  return request;
}

export function ClipboardImage({
  id,
  thumbnail = false,
  alt,
  sourcePath,
  storage = "history",
}: ClipboardImageProps) {
  const cacheKey = makeCacheKey(id, thumbnail, sourcePath, storage);
  const placeholderRef = useRef<HTMLSpanElement>(null);
  const assetUrl = useMemo(() => {
    if (!sourcePath || !isTauri()) return null;
    try {
      return convertFileSrc(sourcePath);
    } catch {
      return null;
    }
  }, [sourcePath]);
  const [imageState, setImageState] = useState<ImageState>(() => ({
    cacheKey,
    source: assetUrl && !thumbnail ? assetUrl : readCachedImage(cacheKey),
  }));
  const [visibleCacheKey, setVisibleCacheKey] = useState<string | null>(null);
  const [assetFailureKey, setAssetFailureKey] = useState<string | null>(null);
  const [errorCacheKey, setErrorCacheKey] = useState<string | null>(null);
  const source = imageState.cacheKey === cacheKey
    ? imageState.source
    : readCachedImage(cacheKey);
  const hasError = errorCacheKey === cacheKey;
  const assetFailed = assetFailureKey === cacheKey;
  const shouldLoad = !thumbnail || visibleCacheKey === cacheKey;
  const canUseAsset = Boolean(assetUrl && !assetFailed && shouldLoad);

  useEffect(() => {
    if (canUseAsset && assetUrl) {
      if (source !== assetUrl) setImageState({ cacheKey, source: assetUrl });
      return;
    }
    if (source === null || imageState.cacheKey !== cacheKey) {
      const cached = readCachedImage(cacheKey);
      if (cached !== source) setImageState({ cacheKey, source: cached });
    }
  }, [assetUrl, cacheKey, canUseAsset, imageState.cacheKey, source]);

  useEffect(() => {
    if (!thumbnail || source !== null || hasError || shouldLoad) return;

    const placeholder = placeholderRef.current;
    if (!placeholder || typeof IntersectionObserver === "undefined") {
      setVisibleCacheKey(cacheKey);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setVisibleCacheKey(cacheKey);
        observer.disconnect();
      },
      {
        root: placeholder.closest(".history-scroll"),
        rootMargin: "160px 0px",
      },
    );
    observer.observe(placeholder);
    return () => observer.disconnect();
  }, [cacheKey, hasError, shouldLoad, source, thumbnail]);

  useEffect(() => {
    if (source !== null || hasError || !shouldLoad || canUseAsset) return;

    let disposed = false;
    setImageState({ cacheKey, source: null });
    setErrorCacheKey(null);
    void loadImage(id, thumbnail, cacheKey, storage)
      .then((value) => {
        if (!disposed) setImageState({ cacheKey, source: value });
      })
      .catch(() => {
        if (!disposed) setErrorCacheKey(cacheKey);
      });
    return () => {
      disposed = true;
    };
  }, [cacheKey, canUseAsset, hasError, id, shouldLoad, source, storage, thumbnail]);

  const handleImageError = useCallback(() => {
    // The asset protocol is the primary path for large originals. If the file
    // was removed or the protocol is unavailable, retry once through the
    // existing IPC/data-url path before showing a finite error state.
    if (assetUrl && !assetFailed) {
      setAssetFailureKey(cacheKey);
      setImageState({ cacheKey, source: readCachedImage(cacheKey) });
      return;
    }
    removeCachedImage(cacheKey);
    setImageState({ cacheKey, source: null });
    setErrorCacheKey(cacheKey);
  }, [assetFailed, assetUrl, cacheKey]);

  if (hasError) {
    return (
      <span className="image-error" role="img" aria-label={alt ? `${alt}載入失敗` : "圖片載入失敗"}>
        圖片載入失敗
      </span>
    );
  }

  if (source !== null) {
    return (
      <img
        src={source}
        alt={alt}
        decoding="async"
        loading={thumbnail ? "lazy" : "eager"}
        onError={handleImageError}
      />
    );
  }

  return (
    <span
      ref={placeholderRef}
      className="image-loading"
      aria-label={shouldLoad ? "正在載入圖片" : "圖片縮圖等待載入"}
    />
  );
}
