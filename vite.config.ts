import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { threlteStudio } from "@threlte/studio/vite";
import { visualizer } from "rollup-plugin-visualizer";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    threlteStudio(),
    svelte(),
    visualizer({
      filename: "stats.html",
      open: false,
      gzipSize: true,
    }),
  ],
});
