import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Port 4173 is the only origin the UAT kit allows in config/guardrails.yaml.
export default defineConfig({
  plugins: [react()],
  server: { port: 4173, strictPort: true },
  preview: { port: 4173, strictPort: true },
});
