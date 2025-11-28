import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
    server: {
        host: true, // Expose to network
        https: true, // Enable HTTPS
        port: 5173,
        strictPort: true
    },
    plugins: [
        basicSsl()
    ]
});
