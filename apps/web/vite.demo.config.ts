import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build da demonstração autocontida (servidor simulado no navegador), em um único arquivo JS.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist-demo',
    emptyOutDir: true,
    assetsInlineLimit: 100000000,
    cssCodeSplit: false,
    rollupOptions: { input: 'demo.html', output: { inlineDynamicImports: true } },
  },
});
