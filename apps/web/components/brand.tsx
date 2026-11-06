// The Tessera mark: three blades built from arcs, meeting near one point, in vermilion on the dark plate.
import { cx } from "./primitives";

/** Blade outlines in a 120 x 100 box; every edge is a straight line or a circular arc. */
export const MARK_PATHS = [
  "M0 4 A90.006 90.006 0 0 1 90 93 A127.959 127.959 0 0 0 0 56 Z",
  "M0 74 A168.769 168.769 0 0 1 90 100 L0 100 Z",
  "M67 0 L120 0 L120 60.744 A45 45 0 0 1 97 100 A200 200 0 0 0 67 0 Z",
];

/** The mark on its plate. At this size it is drawn solid with the gaps opened by a plate-coloured stroke, and the
 *  viewBox is shifted so the mark sits on its optical centre, up and left, since its weight pools bottom right. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cx("inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-brand-ink p-1.5", className)}>
      <svg viewBox="-0.4 1.3 128 108" className="h-full w-full overflow-visible">
        <g className="fill-brand-mark stroke-brand-ink" strokeWidth={3.2} strokeLinejoin="round">
          {MARK_PATHS.map((d) => <path key={d} d={d} />)}
        </g>
      </svg>
    </span>
  );
}
