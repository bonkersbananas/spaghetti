import { type ComponentPropsWithRef, forwardRef, useRef } from "react";
import { cn } from "@/lib/cn";
import { CloseIcon, type Icon } from "./icons";
import { Photo } from "./Photo";
import { ProgressRing } from "./UploadBadge";

interface AddPhotoTileProps extends Omit<ComponentPropsWithRef<"button">, "children"> {
  icon: Icon;
  label: string;
  /** "lg" is the big empty-state tile; "md" and "sm" end a row of photos (sm shows only the icon). */
  size?: "lg" | "md" | "sm";
}

/** A well to tap (or drop on) to add photos. */
export const AddPhotoTile = forwardRef<HTMLButtonElement, AddPhotoTileProps>(function AddPhotoTile(
  { icon: IconComponent, label, size = "lg", className, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        "pressable focus-ring bg-ink/4 text-ink-soft shadow-well hover:bg-ink/6 hover:text-ink flex shrink-0 flex-col items-center justify-center rounded-lg",
        size === "lg" && "h-28 gap-2",
        size === "md" && "text-caption size-24 gap-1 rounded-md font-semibold",
        size === "sm" && "size-16 rounded-md",
        className,
      )}
      aria-label={size === "sm" ? label : undefined}
      title={size === "sm" ? label : undefined}
      {...props}
    >
      <IconComponent size={size === "lg" ? 28 : 22} aria-hidden />
      {size !== "sm" && (
        <span className={cn(size === "lg" ? "text-small font-semibold" : "px-1 text-center leading-tight")}>
          {label}
        </span>
      )}
    </button>
  );
});

interface PhotoThumbProps {
  src: string;
  /** "md" in the capture sheet, "sm" in an idea's strip. */
  size?: "md" | "sm";
  alt: string;
  color?: string;
  /** Still being resized or uploaded. */
  busy?: boolean;
  onRemove?: () => void;
  className?: string;
}

/** A square photo in a row of them, with a remove button. */
export function PhotoThumb({ src, alt, color, size = "md", busy, onRemove, className }: PhotoThumbProps) {
  return (
    <div className={cn("relative shrink-0", size === "md" ? "size-24" : "size-16", className)}>
      <Photo src={src} alt={alt} color={color} eager className="shadow-soft size-full rounded-md" />
      {busy && (
        <span className="bg-ink/55 text-paper absolute bottom-1.5 left-1.5 flex size-6 items-center justify-center rounded-full backdrop-blur-md">
          <ProgressRing value={null} className="size-3.5" />
        </span>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${alt}`}
          className="pressable focus-ring bg-ink/60 text-paper hover:bg-ink/80 absolute top-1 right-1 flex size-7 items-center justify-center rounded-full backdrop-blur-md"
        >
          <CloseIcon size={14} weight="bold" aria-hidden />
        </button>
      )}
    </div>
  );
}

interface FilePickerOptions {
  /** Opens the camera directly on phones. */
  camera?: boolean;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
}

/** A hidden file input and a function to open it. */
export function useFilePicker({ camera, multiple, onFiles }: FilePickerOptions) {
  const inputRef = useRef<HTMLInputElement>(null);
  const input = (
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      capture={camera ? "environment" : undefined}
      multiple={multiple}
      hidden
      data-testid={camera ? "camera-input" : "photo-input"}
      onChange={(event) => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = "";
        if (files.length) onFiles(files);
      }}
    />
  );
  return { input, open: () => inputRef.current?.click() };
}
