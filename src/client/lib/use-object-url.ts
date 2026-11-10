import { useEffect, useState } from "react";

/**
 * An object URL for a Blob or File, made while it is shown and revoked after.
 * Made in an effect (not during render), so React's double effects in
 * development never leave an image pointing at a revoked URL.
 */
export function useObjectUrl(blob: Blob | undefined | null): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) {
      setUrl(undefined);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}
