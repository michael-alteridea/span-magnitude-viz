import { createSpanMagnitudeViz } from "span-magnitude-viz";
import sample from "./data/standalone-sample.json";

const host = document.getElementById("chart-host");
if (!host) throw new Error("#chart-host missing");

const viz = createSpanMagnitudeViz(host, sample, {
  geometry: "arc",
  width: Math.min(960, host.clientWidth || 960),
  height: 480,
  animate: true,
  autoplay: true,
  theme: "dark",
  slowFirst: 2,
  durationMs: 9000,
  tickers: true,
});

document.getElementById("replay")?.addEventListener("click", () => {
  viz.reset();
  viz.play();
});
