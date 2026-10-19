// Sonora: busca sola, en la red Wi-Fi, la computadora donde corre Sonora.
// Archivo normal (no módulo): deja `window.Discover`. Se usa dentro de la app del celular.
(function () {
  'use strict';

  const COMMON = ['192.168.0', '192.168.1', '192.168.100', '192.168.2', '192.168.43', '192.168.68', '192.168.137', '10.0.0', '10.0.1', '10.1.1', '172.20.10'];
  const prefixOf = (url) => (/^https?:\/\/(\d+\.\d+\.\d+)\.\d+/.exec(url || '') || [])[1] || '';
  const portOf = (url) => Number((/:(\d+)\/?$/.exec(url || '') || [])[1]) || 3000;
  const hostOf = (url) => (/^https?:\/\/(\d+\.\d+\.\d+\.\d+)/.exec(url || '') || [])[1] || '';

  // Intenta saber la red del propio celular (puede no estar disponible: entonces se prueban las redes comunes).
  function localPrefix() {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        try {
          pc.close();
        } catch {
          /* nada */
        }
        resolve(v);
      };
      let pc;
      try {
        pc = new RTCPeerConnection({ iceServers: [] });
        pc.createDataChannel('x');
        pc.onicecandidate = (e) => {
          const m = e.candidate && /(\d+\.\d+\.\d+)\.\d+/.exec(e.candidate.candidate);
          if (m && !/^(0|127|169)\./.test(m[1])) finish(m[1]);
        };
        pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(() => finish(''));
        setTimeout(() => finish(''), 1200);
      } catch {
        resolve('');
      }
    });
  }

  // Devuelve 'sonora' (confirmado), 'quizas' (responde pero sin permiso de lectura: servidor antiguo) o ''.
  async function probe(url, ms) {
    const ctrl = new AbortController();
    const started = Date.now();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(`${url}/api/session`, { cache: 'no-store', signal: ctrl.signal });
      const j = await res.json().catch(() => ({}));
      return j && (j.app === 'sonora' || 'authRequired' in j) ? 'sonora' : '';
    } catch {
      // Si falló rápido, algo respondió pero no dejó leer: puede ser una versión antigua de Sonora.
      if (Date.now() - started > ms * 0.8) return '';
      try {
        const c2 = new AbortController();
        const t2 = setTimeout(() => c2.abort(), ms);
        await fetch(`${url}/api/session`, { mode: 'no-cors', cache: 'no-store', signal: c2.signal });
        clearTimeout(t2);
        return 'quizas';
      } catch {
        return '';
      }
    } finally {
      clearTimeout(timer);
    }
  }

  // hint: dirección conocida de antes (se prueba primero). Devuelve la dirección encontrada o ''.
  async function find({ hint = '', onProgress = () => {}, shouldStop = () => false } = {}) {
    const port = portOf(hint);
    const ports = [...new Set([port, 3000])];
    const mine = await localPrefix();
    const prefixes = [...new Set([prefixOf(hint), mine, ...COMMON].filter(Boolean))];

    // Primero la dirección de antes: si la PC conserva su IP, aparece al instante.
    const known = hostOf(hint);
    if (known && (await probe(`http://${known}:${port}`, 1500)) === 'sonora') return `http://${known}:${port}`;

    const hosts = [];
    for (const pre of prefixes) for (let i = 1; i <= 254; i++) for (const p of ports) hosts.push(`http://${pre}.${i}:${p}`);
    let next = 0;
    let done = 0;
    let found = '';
    let maybe = '';
    const worker = async () => {
      while (!found && !shouldStop() && next < hosts.length) {
        const url = hosts[next++];
        const r = await probe(url, 700);
        done += 1;
        if (r === 'sonora') found = url;
        else if (r === 'quizas' && !maybe) maybe = url;
        if (done % 25 === 0) onProgress(Math.round((done * 100) / hosts.length));
      }
    };
    await Promise.all(Array.from({ length: 48 }, worker));
    return found || maybe;
  }

  window.Discover = { find, probe };
})();
