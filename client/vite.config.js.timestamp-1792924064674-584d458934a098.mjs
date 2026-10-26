// vite.config.js
import { defineConfig, loadEnv } from "file:///Users/syrine/Documents/Labo%20dahmani/labo-dentaire%203/client/node_modules/vite/dist/node/index.js";
import react from "file:///Users/syrine/Documents/Labo%20dahmani/labo-dentaire%203/client/node_modules/@vitejs/plugin-react/dist/index.js";
import http from "node:http";
import https from "node:https";
function probe(url, timeout = 3e3) {
  return new Promise((resolve) => {
    const get = url.startsWith("https") ? https.get : http.get;
    const req = get(url, (res) => {
      let body = "";
      res.on("data", (c) => {
        if (body.length < 2e3) body += c;
      });
      res.on("end", () => resolve({ status: res.statusCode, body, server: res.headers.server || res.headers["x-powered-by"] || "" }));
    });
    req.on("error", (e) => resolve({ error: e.code || e.message }));
    req.setTimeout(timeout, () => {
      req.destroy();
      resolve({ error: "TIMEOUT" });
    });
  });
}
var isOurs = (r) => r.status === 200 && r.body.includes('"app":"labo-dentaire"');
var isOldOurs = (r) => /Authentification requise|Route inconnue|Session expirée/.test(r.body || "");
var describe = (r) => r.error ? `pas de r\xE9ponse (${r.error})` : `HTTP ${r.status}${r.server ? `, ${r.server}` : ""} : ${r.body.replace(/\s+/g, " ").trim().slice(0, 120) || "(r\xE9ponse vide)"}`;
async function checkApi(target) {
  const r = await probe(`${target}/api/health`);
  if (isOurs(r)) {
    console.log(`  \u279C  API:     ${target} (connect\xE9e)`);
    return;
  }
  let msg;
  if (r.error) msg = `Le serveur API ne r\xE9pond pas sur ${target} (${r.error}).
  Lancez-le avec \xAB npm run dev:server \xBB (dossier racine), ou corrigez APP_URL dans server/.env.`;
  else if (isOldOurs(r)) msg = `${target} est bien le serveur du laboratoire, mais une ANCIENNE version est en cours d'ex\xE9cution.
  Arr\xEAtez-le (Ctrl+C dans son terminal) puis relancez \xAB npm run dev:server \xBB pour prendre en compte les fichiers mis \xE0 jour.`;
  else msg = `Un autre programme r\xE9pond sur ${target} :
    ${describe(r)}
  Arr\xEAtez-le, ou changez PORT et APP_URL dans server/.env.`;
  const u = new URL(target);
  if (u.hostname === "localhost") {
    const port = u.port || (u.protocol === "https:" ? "443" : "80");
    const [v4, v6] = await Promise.all([
      probe(`${u.protocol}//127.0.0.1:${port}/api/health`),
      probe(`${u.protocol}//[::1]:${port}/api/health`)
    ]);
    const noV6 = /EAFNOSUPPORT|EADDRNOTAVAIL/.test(v6.error || "");
    msg += `
  D\xE9tail : 127.0.0.1:${port} \u2192 ${isOurs(v4) ? "serveur du laboratoire" : describe(v4)}`;
    if (!noV6) msg += `
           [::1]:${port}     \u2192 ${isOurs(v6) ? "serveur du laboratoire" : describe(v6)}`;
    if (!noV6 && isOurs(v4) !== isOurs(v6)) {
      const good = isOurs(v4) ? `127.0.0.1:${port}` : `[::1]:${port}`;
      msg += `
  Deux programmes diff\xE9rents \xE9coutent sur le port ${port}. Solution rapide : APP_URL=${u.protocol}//${good} dans server/.env,
  ou arr\xEAtez l'autre programme (Windows : netstat -ano | findstr :${port}  puis  taskkill /PID <pid> /F).`;
    }
  }
  console.warn(`
[api] ${msg}
`);
}
var vite_config_default = defineConfig(({ mode }) => {
  const serverEnv = loadEnv(mode, "../server", "");
  const APP_URL = (process.env.APP_URL ?? serverEnv.APP_URL ?? "").trim().replace(/\/+$/, "");
  const apiPort = process.env.PORT || serverEnv.PORT || "4000";
  const target = APP_URL || `http://127.0.0.1:${apiPort}`;
  return {
    // Variable globale disponible dans le code client : import.meta.env.APP_URL.
    // Seule APP_URL est exposée ; les autres variables de server/.env (secrets) restent côté serveur.
    define: {
      "import.meta.env.APP_URL": JSON.stringify(APP_URL)
    },
    plugins: [
      react(),
      { name: "api-check", configureServer() {
        setTimeout(() => checkApi(target), 500);
      } }
    ],
    server: {
      port: 5173,
      // Utilisé seulement si APP_URL est vide (requêtes relatives /api)
      proxy: { "/api": { target, changeOrigin: false } }
    }
  };
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvVXNlcnMvc3lyaW5lL0RvY3VtZW50cy9MYWJvIGRhaG1hbmkvbGFiby1kZW50YWlyZSAzL2NsaWVudFwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL1VzZXJzL3N5cmluZS9Eb2N1bWVudHMvTGFibyBkYWhtYW5pL2xhYm8tZGVudGFpcmUgMy9jbGllbnQvdml0ZS5jb25maWcuanNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL1VzZXJzL3N5cmluZS9Eb2N1bWVudHMvTGFibyUyMGRhaG1hbmkvbGFiby1kZW50YWlyZSUyMDMvY2xpZW50L3ZpdGUuY29uZmlnLmpzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnLCBsb2FkRW52IH0gZnJvbSAndml0ZSc7XG5pbXBvcnQgcmVhY3QgZnJvbSAnQHZpdGVqcy9wbHVnaW4tcmVhY3QnO1xuaW1wb3J0IGh0dHAgZnJvbSAnbm9kZTpodHRwJztcbmltcG9ydCBodHRwcyBmcm9tICdub2RlOmh0dHBzJztcblxuLy8gR0VUIHVybCAtPiB7IHN0YXR1cywgYm9keSwgc2VydmVyIH0gb3IgeyBlcnJvciB9XG5mdW5jdGlvbiBwcm9iZSh1cmwsIHRpbWVvdXQgPSAzMDAwKSB7XG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgIGNvbnN0IGdldCA9IHVybC5zdGFydHNXaXRoKCdodHRwcycpID8gaHR0cHMuZ2V0IDogaHR0cC5nZXQ7XG4gICAgY29uc3QgcmVxID0gZ2V0KHVybCwgKHJlcykgPT4ge1xuICAgICAgbGV0IGJvZHkgPSAnJztcbiAgICAgIHJlcy5vbignZGF0YScsIChjKSA9PiB7IGlmIChib2R5Lmxlbmd0aCA8IDIwMDApIGJvZHkgKz0gYzsgfSk7XG4gICAgICByZXMub24oJ2VuZCcsICgpID0+IHJlc29sdmUoeyBzdGF0dXM6IHJlcy5zdGF0dXNDb2RlLCBib2R5LCBzZXJ2ZXI6IHJlcy5oZWFkZXJzLnNlcnZlciB8fCByZXMuaGVhZGVyc1sneC1wb3dlcmVkLWJ5J10gfHwgJycgfSkpO1xuICAgIH0pO1xuICAgIHJlcS5vbignZXJyb3InLCAoZSkgPT4gcmVzb2x2ZSh7IGVycm9yOiBlLmNvZGUgfHwgZS5tZXNzYWdlIH0pKTtcbiAgICByZXEuc2V0VGltZW91dCh0aW1lb3V0LCAoKSA9PiB7IHJlcS5kZXN0cm95KCk7IHJlc29sdmUoeyBlcnJvcjogJ1RJTUVPVVQnIH0pOyB9KTtcbiAgfSk7XG59XG5cbmNvbnN0IGlzT3VycyA9IChyKSA9PiByLnN0YXR1cyA9PT0gMjAwICYmIHIuYm9keS5pbmNsdWRlcygnXCJhcHBcIjpcImxhYm8tZGVudGFpcmVcIicpO1xuLy8gT3VyIHNlcnZlciBiZWZvcmUgL2FwaS9oZWFsdGggZXhpc3RlZDogYW5zd2VycyB3aXRoIGl0cyBvd24gSlNPTiBlcnJvcnNcbmNvbnN0IGlzT2xkT3VycyA9IChyKSA9PiAvQXV0aGVudGlmaWNhdGlvbiByZXF1aXNlfFJvdXRlIGluY29ubnVlfFNlc3Npb24gZXhwaXJcdTAwRTllLy50ZXN0KHIuYm9keSB8fCAnJyk7XG5jb25zdCBkZXNjcmliZSA9IChyKSA9PiAoci5lcnJvciA/IGBwYXMgZGUgclx1MDBFOXBvbnNlICgke3IuZXJyb3J9KWBcbiAgOiBgSFRUUCAke3Iuc3RhdHVzfSR7ci5zZXJ2ZXIgPyBgLCAke3Iuc2VydmVyfWAgOiAnJ30gOiAke3IuYm9keS5yZXBsYWNlKC9cXHMrL2csICcgJykudHJpbSgpLnNsaWNlKDAsIDEyMCkgfHwgJyhyXHUwMEU5cG9uc2UgdmlkZSknfWApO1xuXG5hc3luYyBmdW5jdGlvbiBjaGVja0FwaSh0YXJnZXQpIHtcbiAgY29uc3QgciA9IGF3YWl0IHByb2JlKGAke3RhcmdldH0vYXBpL2hlYWx0aGApO1xuICBpZiAoaXNPdXJzKHIpKSB7IGNvbnNvbGUubG9nKGAgIFx1Mjc5QyAgQVBJOiAgICAgJHt0YXJnZXR9IChjb25uZWN0XHUwMEU5ZSlgKTsgcmV0dXJuOyB9XG5cbiAgbGV0IG1zZztcbiAgaWYgKHIuZXJyb3IpIG1zZyA9IGBMZSBzZXJ2ZXVyIEFQSSBuZSByXHUwMEU5cG9uZCBwYXMgc3VyICR7dGFyZ2V0fSAoJHtyLmVycm9yfSkuXFxuICBMYW5jZXotbGUgYXZlYyBcdTAwQUIgbnBtIHJ1biBkZXY6c2VydmVyIFx1MDBCQiAoZG9zc2llciByYWNpbmUpLCBvdSBjb3JyaWdleiBBUFBfVVJMIGRhbnMgc2VydmVyLy5lbnYuYDtcbiAgZWxzZSBpZiAoaXNPbGRPdXJzKHIpKSBtc2cgPSBgJHt0YXJnZXR9IGVzdCBiaWVuIGxlIHNlcnZldXIgZHUgbGFib3JhdG9pcmUsIG1haXMgdW5lIEFOQ0lFTk5FIHZlcnNpb24gZXN0IGVuIGNvdXJzIGQnZXhcdTAwRTljdXRpb24uXFxuICBBcnJcdTAwRUF0ZXotbGUgKEN0cmwrQyBkYW5zIHNvbiB0ZXJtaW5hbCkgcHVpcyByZWxhbmNleiBcdTAwQUIgbnBtIHJ1biBkZXY6c2VydmVyIFx1MDBCQiBwb3VyIHByZW5kcmUgZW4gY29tcHRlIGxlcyBmaWNoaWVycyBtaXMgXHUwMEUwIGpvdXIuYDtcbiAgZWxzZSBtc2cgPSBgVW4gYXV0cmUgcHJvZ3JhbW1lIHJcdTAwRTlwb25kIHN1ciAke3RhcmdldH0gOlxcbiAgICAke2Rlc2NyaWJlKHIpfVxcbiAgQXJyXHUwMEVBdGV6LWxlLCBvdSBjaGFuZ2V6IFBPUlQgZXQgQVBQX1VSTCBkYW5zIHNlcnZlci8uZW52LmA7XG5cbiAgLy8gXCJsb2NhbGhvc3RcIiBjYW4gcG9pbnQgdG8gdHdvIGRpZmZlcmVudCBwcm9ncmFtcyAoSVB2NCAxMjcuMC4wLjEgdnMgSVB2NiA6OjEpLCBjb21tb24gb24gV2luZG93c1xuICBjb25zdCB1ID0gbmV3IFVSTCh0YXJnZXQpO1xuICBpZiAodS5ob3N0bmFtZSA9PT0gJ2xvY2FsaG9zdCcpIHtcbiAgICBjb25zdCBwb3J0ID0gdS5wb3J0IHx8ICh1LnByb3RvY29sID09PSAnaHR0cHM6JyA/ICc0NDMnIDogJzgwJyk7XG4gICAgY29uc3QgW3Y0LCB2Nl0gPSBhd2FpdCBQcm9taXNlLmFsbChbXG4gICAgICBwcm9iZShgJHt1LnByb3RvY29sfS8vMTI3LjAuMC4xOiR7cG9ydH0vYXBpL2hlYWx0aGApLFxuICAgICAgcHJvYmUoYCR7dS5wcm90b2NvbH0vL1s6OjFdOiR7cG9ydH0vYXBpL2hlYWx0aGApLFxuICAgIF0pO1xuICAgIGNvbnN0IG5vVjYgPSAvRUFGTk9TVVBQT1JUfEVBRERSTk9UQVZBSUwvLnRlc3QodjYuZXJyb3IgfHwgJycpOyAgIC8vIG1hY2hpbmUgd2l0aG91dCBJUHY2XG4gICAgbXNnICs9IGBcXG4gIERcdTAwRTl0YWlsIDogMTI3LjAuMC4xOiR7cG9ydH0gXHUyMTkyICR7aXNPdXJzKHY0KSA/ICdzZXJ2ZXVyIGR1IGxhYm9yYXRvaXJlJyA6IGRlc2NyaWJlKHY0KX1gO1xuICAgIGlmICghbm9WNikgbXNnICs9IGBcXG4gICAgICAgICAgIFs6OjFdOiR7cG9ydH0gICAgIFx1MjE5MiAke2lzT3Vycyh2NikgPyAnc2VydmV1ciBkdSBsYWJvcmF0b2lyZScgOiBkZXNjcmliZSh2Nil9YDtcbiAgICBpZiAoIW5vVjYgJiYgaXNPdXJzKHY0KSAhPT0gaXNPdXJzKHY2KSkge1xuICAgICAgY29uc3QgZ29vZCA9IGlzT3Vycyh2NCkgPyBgMTI3LjAuMC4xOiR7cG9ydH1gIDogYFs6OjFdOiR7cG9ydH1gO1xuICAgICAgbXNnICs9IGBcXG4gIERldXggcHJvZ3JhbW1lcyBkaWZmXHUwMEU5cmVudHMgXHUwMEU5Y291dGVudCBzdXIgbGUgcG9ydCAke3BvcnR9LiBTb2x1dGlvbiByYXBpZGUgOiBBUFBfVVJMPSR7dS5wcm90b2NvbH0vLyR7Z29vZH0gZGFucyBzZXJ2ZXIvLmVudixgXG4gICAgICAgICsgYFxcbiAgb3UgYXJyXHUwMEVBdGV6IGwnYXV0cmUgcHJvZ3JhbW1lIChXaW5kb3dzIDogbmV0c3RhdCAtYW5vIHwgZmluZHN0ciA6JHtwb3J0fSAgcHVpcyAgdGFza2tpbGwgL1BJRCA8cGlkPiAvRikuYDtcbiAgICB9XG4gIH1cbiAgY29uc29sZS53YXJuKGBcXG5bYXBpXSAke21zZ31cXG5gKTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKCh7IG1vZGUgfSkgPT4ge1xuICAvLyBDb25maWd1cmF0aW9uIHBhcnRhZ1x1MDBFOWUgYXZlYyBsZSBzZXJ2ZXVyIDogc2VydmVyLy5lbnYgKGxlcyB2YXJpYWJsZXMgc3lzdFx1MDBFOG1lIG9udCBwcmlvcml0XHUwMEU5KVxuICBjb25zdCBzZXJ2ZXJFbnYgPSBsb2FkRW52KG1vZGUsICcuLi9zZXJ2ZXInLCAnJyk7XG4gIGNvbnN0IEFQUF9VUkwgPSAocHJvY2Vzcy5lbnYuQVBQX1VSTCA/PyBzZXJ2ZXJFbnYuQVBQX1VSTCA/PyAnJykudHJpbSgpLnJlcGxhY2UoL1xcLyskLywgJycpO1xuICBjb25zdCBhcGlQb3J0ID0gcHJvY2Vzcy5lbnYuUE9SVCB8fCBzZXJ2ZXJFbnYuUE9SVCB8fCAnNDAwMCc7XG4gIC8vIFNlcnZldXIgQVBJIDogQVBQX1VSTCBzaSBkXHUwMEU5ZmluaSwgc2lub24gbGUgcG9ydCBsb2NhbCBkdSBzZXJ2ZXVyXG4gIGNvbnN0IHRhcmdldCA9IEFQUF9VUkwgfHwgYGh0dHA6Ly8xMjcuMC4wLjE6JHthcGlQb3J0fWA7XG5cbiAgcmV0dXJuIHtcbiAgICAvLyBWYXJpYWJsZSBnbG9iYWxlIGRpc3BvbmlibGUgZGFucyBsZSBjb2RlIGNsaWVudCA6IGltcG9ydC5tZXRhLmVudi5BUFBfVVJMLlxuICAgIC8vIFNldWxlIEFQUF9VUkwgZXN0IGV4cG9zXHUwMEU5ZSA7IGxlcyBhdXRyZXMgdmFyaWFibGVzIGRlIHNlcnZlci8uZW52IChzZWNyZXRzKSByZXN0ZW50IGNcdTAwRjR0XHUwMEU5IHNlcnZldXIuXG4gICAgZGVmaW5lOiB7XG4gICAgICAnaW1wb3J0Lm1ldGEuZW52LkFQUF9VUkwnOiBKU09OLnN0cmluZ2lmeShBUFBfVVJMKSxcbiAgICB9LFxuICAgIHBsdWdpbnM6IFtcbiAgICAgIHJlYWN0KCksXG4gICAgICB7IG5hbWU6ICdhcGktY2hlY2snLCBjb25maWd1cmVTZXJ2ZXIoKSB7IHNldFRpbWVvdXQoKCkgPT4gY2hlY2tBcGkodGFyZ2V0KSwgNTAwKTsgfSB9LFxuICAgIF0sXG4gICAgc2VydmVyOiB7XG4gICAgICBwb3J0OiA1MTczLFxuICAgICAgLy8gVXRpbGlzXHUwMEU5IHNldWxlbWVudCBzaSBBUFBfVVJMIGVzdCB2aWRlIChyZXF1XHUwMEVBdGVzIHJlbGF0aXZlcyAvYXBpKVxuICAgICAgcHJveHk6IHsgJy9hcGknOiB7IHRhcmdldCwgY2hhbmdlT3JpZ2luOiBmYWxzZSB9IH0sXG4gICAgfSxcbiAgfTtcbn0pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUF1VyxTQUFTLGNBQWMsZUFBZTtBQUM3WSxPQUFPLFdBQVc7QUFDbEIsT0FBTyxVQUFVO0FBQ2pCLE9BQU8sV0FBVztBQUdsQixTQUFTLE1BQU0sS0FBSyxVQUFVLEtBQU07QUFDbEMsU0FBTyxJQUFJLFFBQVEsQ0FBQyxZQUFZO0FBQzlCLFVBQU0sTUFBTSxJQUFJLFdBQVcsT0FBTyxJQUFJLE1BQU0sTUFBTSxLQUFLO0FBQ3ZELFVBQU0sTUFBTSxJQUFJLEtBQUssQ0FBQyxRQUFRO0FBQzVCLFVBQUksT0FBTztBQUNYLFVBQUksR0FBRyxRQUFRLENBQUMsTUFBTTtBQUFFLFlBQUksS0FBSyxTQUFTLElBQU0sU0FBUTtBQUFBLE1BQUcsQ0FBQztBQUM1RCxVQUFJLEdBQUcsT0FBTyxNQUFNLFFBQVEsRUFBRSxRQUFRLElBQUksWUFBWSxNQUFNLFFBQVEsSUFBSSxRQUFRLFVBQVUsSUFBSSxRQUFRLGNBQWMsS0FBSyxHQUFHLENBQUMsQ0FBQztBQUFBLElBQ2hJLENBQUM7QUFDRCxRQUFJLEdBQUcsU0FBUyxDQUFDLE1BQU0sUUFBUSxFQUFFLE9BQU8sRUFBRSxRQUFRLEVBQUUsUUFBUSxDQUFDLENBQUM7QUFDOUQsUUFBSSxXQUFXLFNBQVMsTUFBTTtBQUFFLFVBQUksUUFBUTtBQUFHLGNBQVEsRUFBRSxPQUFPLFVBQVUsQ0FBQztBQUFBLElBQUcsQ0FBQztBQUFBLEVBQ2pGLENBQUM7QUFDSDtBQUVBLElBQU0sU0FBUyxDQUFDLE1BQU0sRUFBRSxXQUFXLE9BQU8sRUFBRSxLQUFLLFNBQVMsdUJBQXVCO0FBRWpGLElBQU0sWUFBWSxDQUFDLE1BQU0sMERBQTBELEtBQUssRUFBRSxRQUFRLEVBQUU7QUFDcEcsSUFBTSxXQUFXLENBQUMsTUFBTyxFQUFFLFFBQVEsc0JBQW1CLEVBQUUsS0FBSyxNQUN6RCxRQUFRLEVBQUUsTUFBTSxHQUFHLEVBQUUsU0FBUyxLQUFLLEVBQUUsTUFBTSxLQUFLLEVBQUUsTUFBTSxFQUFFLEtBQUssUUFBUSxRQUFRLEdBQUcsRUFBRSxLQUFLLEVBQUUsTUFBTSxHQUFHLEdBQUcsS0FBSyxtQkFBZ0I7QUFFaEksZUFBZSxTQUFTLFFBQVE7QUFDOUIsUUFBTSxJQUFJLE1BQU0sTUFBTSxHQUFHLE1BQU0sYUFBYTtBQUM1QyxNQUFJLE9BQU8sQ0FBQyxHQUFHO0FBQUUsWUFBUSxJQUFJLHNCQUFpQixNQUFNLGlCQUFjO0FBQUc7QUFBQSxFQUFRO0FBRTdFLE1BQUk7QUFDSixNQUFJLEVBQUUsTUFBTyxPQUFNLHVDQUFvQyxNQUFNLEtBQUssRUFBRSxLQUFLO0FBQUE7QUFBQSxXQUNoRSxVQUFVLENBQUMsRUFBRyxPQUFNLEdBQUcsTUFBTTtBQUFBO0FBQUEsTUFDakMsT0FBTSxvQ0FBaUMsTUFBTTtBQUFBLE1BQVcsU0FBUyxDQUFDLENBQUM7QUFBQTtBQUd4RSxRQUFNLElBQUksSUFBSSxJQUFJLE1BQU07QUFDeEIsTUFBSSxFQUFFLGFBQWEsYUFBYTtBQUM5QixVQUFNLE9BQU8sRUFBRSxTQUFTLEVBQUUsYUFBYSxXQUFXLFFBQVE7QUFDMUQsVUFBTSxDQUFDLElBQUksRUFBRSxJQUFJLE1BQU0sUUFBUSxJQUFJO0FBQUEsTUFDakMsTUFBTSxHQUFHLEVBQUUsUUFBUSxlQUFlLElBQUksYUFBYTtBQUFBLE1BQ25ELE1BQU0sR0FBRyxFQUFFLFFBQVEsV0FBVyxJQUFJLGFBQWE7QUFBQSxJQUNqRCxDQUFDO0FBQ0QsVUFBTSxPQUFPLDZCQUE2QixLQUFLLEdBQUcsU0FBUyxFQUFFO0FBQzdELFdBQU87QUFBQSwwQkFBMEIsSUFBSSxXQUFNLE9BQU8sRUFBRSxJQUFJLDJCQUEyQixTQUFTLEVBQUUsQ0FBQztBQUMvRixRQUFJLENBQUMsS0FBTSxRQUFPO0FBQUEsbUJBQXNCLElBQUksZUFBVSxPQUFPLEVBQUUsSUFBSSwyQkFBMkIsU0FBUyxFQUFFLENBQUM7QUFDMUcsUUFBSSxDQUFDLFFBQVEsT0FBTyxFQUFFLE1BQU0sT0FBTyxFQUFFLEdBQUc7QUFDdEMsWUFBTSxPQUFPLE9BQU8sRUFBRSxJQUFJLGFBQWEsSUFBSSxLQUFLLFNBQVMsSUFBSTtBQUM3RCxhQUFPO0FBQUEsMERBQXVELElBQUksK0JBQStCLEVBQUUsUUFBUSxLQUFLLElBQUk7QUFBQSx1RUFDekMsSUFBSTtBQUFBLElBQ2pGO0FBQUEsRUFDRjtBQUNBLFVBQVEsS0FBSztBQUFBLFFBQVcsR0FBRztBQUFBLENBQUk7QUFDakM7QUFFQSxJQUFPLHNCQUFRLGFBQWEsQ0FBQyxFQUFFLEtBQUssTUFBTTtBQUV4QyxRQUFNLFlBQVksUUFBUSxNQUFNLGFBQWEsRUFBRTtBQUMvQyxRQUFNLFdBQVcsUUFBUSxJQUFJLFdBQVcsVUFBVSxXQUFXLElBQUksS0FBSyxFQUFFLFFBQVEsUUFBUSxFQUFFO0FBQzFGLFFBQU0sVUFBVSxRQUFRLElBQUksUUFBUSxVQUFVLFFBQVE7QUFFdEQsUUFBTSxTQUFTLFdBQVcsb0JBQW9CLE9BQU87QUFFckQsU0FBTztBQUFBO0FBQUE7QUFBQSxJQUdMLFFBQVE7QUFBQSxNQUNOLDJCQUEyQixLQUFLLFVBQVUsT0FBTztBQUFBLElBQ25EO0FBQUEsSUFDQSxTQUFTO0FBQUEsTUFDUCxNQUFNO0FBQUEsTUFDTixFQUFFLE1BQU0sYUFBYSxrQkFBa0I7QUFBRSxtQkFBVyxNQUFNLFNBQVMsTUFBTSxHQUFHLEdBQUc7QUFBQSxNQUFHLEVBQUU7QUFBQSxJQUN0RjtBQUFBLElBQ0EsUUFBUTtBQUFBLE1BQ04sTUFBTTtBQUFBO0FBQUEsTUFFTixPQUFPLEVBQUUsUUFBUSxFQUFFLFFBQVEsY0FBYyxNQUFNLEVBQUU7QUFBQSxJQUNuRDtBQUFBLEVBQ0Y7QUFDRixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
