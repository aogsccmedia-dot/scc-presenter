// Text and background looks. A theme is plain data so it can travel inside shared show files.
export const THEMES = [
  { id: "classic", name: "Classic dark", font: "Inter, 'Segoe UI', Helvetica, Arial, sans-serif", weight: 700, color: "#ffffff", bg: "#0b0d12", align: "center", valign: "middle", shadow: true, upper: false, maxSize: 96, refColor: "#c9d1e0" },
  { id: "gold", name: "Sunrise gold", font: "Georgia, 'Times New Roman', serif", weight: 600, color: "#fff6e0", bg: "linear-gradient(160deg,#2a1a05,#5c3a0c 55%,#a86a12)", align: "center", valign: "middle", shadow: true, upper: false, maxSize: 92, refColor: "#ffd98a" },
  { id: "white", name: "Clean white", font: "Inter, 'Segoe UI', Helvetica, Arial, sans-serif", weight: 700, color: "#111318", bg: "#ffffff", align: "center", valign: "middle", shadow: false, upper: false, maxSize: 92, refColor: "#555c6b" },
  { id: "lower", name: "Lower third", font: "Inter, 'Segoe UI', Helvetica, Arial, sans-serif", weight: 700, color: "#ffffff", bg: "#000000", align: "center", valign: "bottom", shadow: true, upper: false, maxSize: 64, band: true, refColor: "#e3e7ef" },
  { id: "bold", name: "Bold caps", font: "Impact, 'Arial Black', 'Segoe UI', sans-serif", weight: 800, color: "#ffffff", bg: "#101010", align: "center", valign: "middle", shadow: true, upper: true, maxSize: 110, refColor: "#cfcfcf" },
];

export const themeById = (id, custom = []) => [...custom, ...THEMES].find((t) => t.id === id) || THEMES[0];
