import { Fragment } from "react";
import { cn } from "@/lib/utils";
import { parseBody, type InlinePart } from "@/lib/announcements";

const Inline = ({ parts }: { parts: InlinePart[] }) => (
  <>{parts.map((p, i) => (p.bold ? <strong key={i} className="font-semibold">{p.text}</strong> : <Fragment key={i}>{p.text}</Fragment>))}</>
);

/** An announcement's message with its **bold** and its lists drawn, and nothing else. */
export function AnnouncementBody({ body, className }: { body: string; className?: string }) {
  return (
    <div className={cn("space-y-3 break-words text-[15px] leading-relaxed", className)}>
      {parseBody(body).map((b, i) =>
        b.kind === "list" ? (
          <ul key={i} className="list-disc space-y-1 pl-5 marker:text-muted-foreground">
            {b.items.map((it, j) => <li key={j}><Inline parts={it} /></li>)}
          </ul>
        ) : (
          <p key={i}>
            {b.lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}<Inline parts={l} /></Fragment>)}
          </p>
        ),
      )}
    </div>
  );
}
