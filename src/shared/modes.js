// What each output shows. One live show can drive several screens with different content:
// the projector shows everything, a side screen only the visuals, and the ATEM gets words it can key over cameras.
import { themeById } from "./themes.js";

export const OUTPUT_MODES = {
  full: { name: "Full — words and background", hint: "Projector, TV or LED wall" },
  words: { name: "Words on black — for ATEM luma key", hint: "Laptop HDMI → ATEM input, luma key in the ATEM" },
  green: { name: "Words on green — for chroma key", hint: "Any switcher or OBS with a chroma key" },
  fill: { name: "Fill — coloured words on black", hint: "Linear key: fill input (use with a Key output)" },
  key: { name: "Key — white shape of the words", hint: "Linear key: key/cut input (use with a Fill output)" },
  visuals: { name: "Visuals only — no words", hint: "Side screens and LED walls" },
  stage: { name: "Stage screen", hint: "Current + next slide, clock, timer, messages" },
};

/** The live state as a given output should draw it. Pure, so it can be tested. */
export function stateForMode(state, mode = "full") {
  const s = { ...state };
  if (mode === "full" || mode === "stage" || !OUTPUT_MODES[mode]) return s;
  if (mode === "visuals") return { ...s, clear: true, logo: s.logo };
  const isMediaSlide = s.slide?.kind === "media";
  const base = themeById(s.themeId, s.themes || []);
  const bg = mode === "green" ? "#00b140" : "#000000";
  const theme = { ...base, id: `__${mode}`, bg, band: false };
  if (mode === "key") Object.assign(theme, { color: "#ffffff", refColor: "#ffffff", shadow: false });
  if (mode === "fill") Object.assign(theme, { shadow: false });
  return {
    ...s,
    slide: isMediaSlide ? null : s.slide,
    background: { type: "color", value: bg },
    themeId: theme.id,
    themes: [theme, ...(s.themes || [])],
    logo: false,
    calm: true,
  };
}
