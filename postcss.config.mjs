import tailwind from "@tailwindcss/postcss";
import interfaceTypography from "./build/interface-typography-postcss.mjs";
const config = { plugins: [tailwind(), interfaceTypography()] };

export default config;
