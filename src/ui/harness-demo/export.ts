import { download } from "./useHarnessDocument";
/** A self-contained drawing, including shared artwork and computed presentation. */
export async function exportDrawing(svg: SVGSVGElement, name: string) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const sources = [svg, ...svg.querySelectorAll("*")],
    targets = [clone, ...clone.querySelectorAll("*")];
  sources.forEach((node, i) => {
    const style = getComputedStyle(node);
    for (const key of [
      "fill",
      "stroke",
      "stroke-width",
      "stroke-linecap",
      "stroke-linejoin",
      "stroke-dasharray",
      "font-family",
      "font-size",
      "font-weight",
      "opacity",
      "filter",
    ])
      (targets[i] as SVGElement).style.setProperty(
        key,
        style.getPropertyValue(key),
      );
  });
  for (const image of clone.querySelectorAll("image")) {
    const href = image.getAttribute("href");
    if (href && !href.startsWith("data:")) {
      const response = await fetch(href);
      if (!response.ok) throw Error("Could not embed connector artwork");
      const text = await response.text();
      image.setAttribute(
        "href",
        `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`,
      );
    }
  }
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", "940");
  clone.setAttribute("height", "1800");
  clone.style.background = "#0d0f0f";
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("width", "940");
  bg.setAttribute("height", "1800");
  bg.setAttribute("fill", "#0d0f0f");
  clone.insertBefore(bg, clone.firstChild);
  clone.querySelectorAll("[tabindex],[role]").forEach((el) => {
    el.removeAttribute("tabindex");
    el.removeAttribute("role");
  });
  download(
    `${name}.svg`,
    new XMLSerializer().serializeToString(clone),
    "image/svg+xml",
  );
}
