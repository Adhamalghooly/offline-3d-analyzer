import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.structural.master',
  appName: 'Structural Master',
  webDir: 'dist/public',
  server: {
    androidScheme: 'https'
  }
};

export default config;
