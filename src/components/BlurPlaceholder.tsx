import { Blurhash } from "react-blurhash";

/** Lightweight blurhash fill while the real image loads. */
export function BlurPlaceholder({ hash }: { hash?: string | null }) {
  if (!hash) {
    return <div className="absolute inset-0 animate-pulse bg-white/5" />;
  }

  return (
    <div className="absolute inset-0 overflow-hidden">
      <Blurhash
        hash={hash}
        width={32}
        height={32}
        resolutionX={32}
        resolutionY={32}
        punch={1}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}
