import { useEffect, useState } from "react";
import { getClipboardImage } from "../lib/clipboard-api";

interface ClipboardImageProps {
  id: string;
  thumbnail?: boolean;
  alt: string;
}

export function ClipboardImage({ id, thumbnail = false, alt }: ClipboardImageProps) {
  const [source, setSource] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    setSource(null);
    void getClipboardImage(id, thumbnail)
      .then((value) => {
        if (!disposed) setSource(value);
      })
      .catch((cause) => console.error(cause));
    return () => { disposed = true; };
  }, [id, thumbnail]);

  return source ? <img src={source} alt={alt} /> : <span className="image-loading" aria-label="正在載入圖片" />;
}
