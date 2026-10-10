import { Fragment } from "react";

/** Renders subtitle text with <i>/<b>/<u> styling, without using innerHTML
 * (subtitle files come from torrents and aren't trusted). */
const CueText = ({ text }: { text: string }) => {
  const parts = text.split(/(<\/?[ibu]>)/g);
  const style = { i: false, b: false, u: false };
  return (
    <>
      {parts.map((part, idx) => {
        const tag = part.match(/^<(\/?)([ibu])>$/);
        if (tag) {
          style[tag[2] as "i" | "b" | "u"] = tag[1] !== "/";
          return null;
        }
        if (!part) return null;
        const className = [style.i && "italic", style.b && "font-bold", style.u && "underline"].filter(Boolean).join(" ");
        return (
          <Fragment key={idx}>{className ? <span className={className}>{part}</span> : part}</Fragment>
        );
      })}
    </>
  );
};

export default CueText;
