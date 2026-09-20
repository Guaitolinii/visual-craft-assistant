import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.sintoniza.iptv",
  appName: "Sintoniza TV",
  webDir: "www",
  android: {
    // Sem isso, o WebView bloqueia qualquer stream http:// puro (a maioria
    // dos canais IPTV reais) mesmo o app não estando em HTTPS - essa flag é
    // equivalente ao android:usesCleartextTraffic="true" do AndroidManifest,
    // aplicada automaticamente pelo Capacitor no build.
    allowMixedContent: true,
  },
  server: {
    // Mantém tudo no mesmo esquema (evita qualquer checagem de conteúdo
    // misto entre o próprio app e os streams http:// que ele carrega).
    androidScheme: "http",
  },
  plugins: {
    // Roteia fetch()/XMLHttpRequest pelo HTTP nativo (URLSession/OkHttp) em
    // vez do WebView - CORS é uma regra só de navegador, então isso permite
    // chamar o player_api.php da Xtream direto do provedor, sem proxy.
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
