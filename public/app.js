let u = {};
let fotoB64 = "";
let fotosSol = {};
let qrScanner = null;
let qrActivo = false;

document.getElementById("btnLogin").addEventListener("click", entrar);

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(text || "Respuesta no válida");
  }
}

async function entrar() {
  const idV = document.getElementById("id").value.trim();
  const pinV = document.getElementById("pin").value.trim();
  if (!idV || !pinV) return alert("Completa los datos");

  document.getElementById("loadL").style.display = "block";

  try {
    const res = await api("/login", {
      method: "POST",
      body: JSON.stringify({ id: idV, pin: pinV })
    });

    document.getElementById("loadL").style.display = "none";

    if (res.success) {
      u = res;
      renderUI();
    } else {
      alert(res.msg || "Error de acceso");
    }
  } catch (err) {
    document.getElementById("loadL").style.display = "none";
    alert("Error de conexión: " + err.message);
  }
}

function renderUI() {
  detenerScanner();

  let html = '<div class="card">';
  html += '<h3>Hola, ' + escapeHtml(u.nombre) + '</h3>';
  html += '<p class="center muted">Rol: ' + escapeHtml(u.rol) + '</p>';

  if (u.rol === "Supervisor") {
    html += '<button class="btn btn-sup" onclick="verPanelIncidencias()">🛠️ GESTIONAR INCIDENCIAS</button>';
    html += '<button class="btn btn-mon" onclick="verMonitorRealTime()">📊 MONITOR EN VIVO</button>';
    html += '<hr style="margin:20px 0; border:0; border-top:1px solid #eef2f7;">';
  }

  if (u.pendiente) {
    html += '<div class="hero-scan">';
    html += '<div class="chip">ÁREA ACTUAL</div>';
    html += '<h3 style="margin-top:10px;">📍 ' + escapeHtml(u.pendiente.area) + '</h3>';
    html += '<p class="small">Agrega evidencia y finaliza la tarea.</p>';
    html += '</div>';

    html += '<button class="btn btn-alt" onclick="document.getElementById(\'f\').click()">📸 FOTO EVIDENCIA</button>';
    html += '<input type="file" id="f" accept="image/*" capture="environment" style="display:none" onchange="pFoto(this)">';
    html += '<img id="preview">';
    html += '<label for="nota">Novedad o falla</label>';
    html += '<textarea id="nota" rows="3" placeholder="Escribe una observación si aplica"></textarea>';
    html += '<button class="btn btn-main" onclick="finalizarArea()">FINALIZAR TAREA</button>';
  } else {
    html += '<div class="hero-scan">';
    html += '<h3 style="margin:0 0 6px;">📷 Escanear QR</h3>';
    html += '<p class="small">Puedes usar cámara en vivo o subir una foto del QR.</p>';
    html += '</div>';

    html += '<button class="btn btn-main" onclick="iniciarScanner()">ESCANEAR CON CÁMARA</button>';
    html += '<div id="reader"></div>';
    html += '<div class="scan-note" id="scanNote"></div>';
    html += '<button class="btn btn-sec" onclick="detenerScanner()">DETENER CÁMARA</button>';

    html += '<hr style="margin:18px 0; border:0; border-top:1px solid #eef2f7;">';
    html += '<button class="btn btn-alt" onclick="document.getElementById(\'q\').click()">SUBIR / TOMAR FOTO QR</button>';
    html += '<input type="file" id="q" accept="image/*" capture="environment" style="display:none" onchange="pQR(this)">';
  }

  html += '<button class="logout" onclick="location.reload()">Cerrar sesión</button>';
  html += '</div>';

  document.getElementById('mainCont').innerHTML = html;
}

function iniciarScanner() {
  const readerEl = document.getElementById("reader");
  const noteEl = document.getElementById("scanNote");
  if (!readerEl) return;

  readerEl.style.display = "block";
  if (noteEl) noteEl.textContent = "Enfoca el QR dentro del recuadro.";

  detenerScanner(true);

  qrScanner = new Html5Qrcode("reader");
  qrActivo = true;

  Html5Qrcode.getCameras().then(function(cameras) {
    if (!cameras || !cameras.length) {
      if (noteEl) noteEl.textContent = "No se detectó cámara disponible.";
      return;
    }

    const rearCamera = cameras.find(c =>
      /back|rear|environment|trasera/i.test(c.label || "")
    ) || cameras[0];

    qrScanner.start(
      rearCamera.id,
      {
        fps: 10,
        qrbox: { width: 220, height: 220 },
        aspectRatio: 1
      },
      function(decodedText) {
        if (!qrActivo) return;
        qrActivo = false;
        detenerScanner(true);
        registrarEntradaQR(decodedText);
      },
      function() {}
    ).catch(function(err) {
      if (noteEl) noteEl.textContent = "No se pudo iniciar la cámara. " + err;
    });
  }).catch(function(err) {
    if (noteEl) noteEl.textContent = "Error al consultar cámaras. " + err;
  });
}

function detenerScanner(silencioso) {
  qrActivo = false;
  if (qrScanner) {
    qrScanner.stop()
      .then(() => qrScanner.clear())
      .catch(() => {})
      .finally(() => {
        qrScanner = null;
        const readerEl = document.getElementById("reader");
        if (readerEl && !silencioso) readerEl.style.display = "none";
      });
  } else {
    const readerEl = document.getElementById("reader");
    if (readerEl && !silencioso) readerEl.style.display = "none";
  }
}

async function registrarEntradaQR(valorQR) {
  document.getElementById('mainCont').innerHTML =
    '<div class="card center"><h3>Registrando...</h3><div class="loader" style="display:block"></div></div>';

  try {
    const res = await api("/entrada", {
      method: "POST",
      body: JSON.stringify({ id: u.id, qr: valorQR })
    });

    alert(res.msg || "Registrado");
    await actualizarEstadoInterno();
  } catch (err) {
    alert("Error al registrar: " + err.message);
    renderUI();
  }
}

async function verMonitorRealTime() {
  detenerScanner();
  document.getElementById('mainCont').innerHTML =
    '<div class="card center"><h3>Consultando Monitor...</h3><div class="loader" style="display:block"></div></div>';

  try {
    const res = await api("/monitor");
    const lista = res.data || [];
    let html = '<div class="card"><h3>Monitor de Actividad</h3>';

    if (!lista.length) {
      html += '<p class="center muted">No hay datos disponibles</p>';
    } else {
      lista.forEach(function(item) {
        const claseAlerta = item.tiempo > 45 && item.estado !== "LIBRE / COMIDA" ? 'alerta-exceso' : '';
        html += '<div class="item-pend ' + claseAlerta + '">';
        html += '<span style="float:right">' + escapeHtml(item.alerta) + '</span>';
        html += '<b>👤 ' + escapeHtml(item.nombre) + '</b><br>';
        html += '📍 Área: ' + escapeHtml(item.area) + '<br>';
        html += '⏱️ Inicio: ' + escapeHtml(item.inicio) + ' (' + escapeHtml(String(item.tiempo)) + ' min)';
        html += '</div>';
      });
    }

    html += '<button class="btn btn-sec" onclick="renderUI()">VOLVER</button></div>';
    document.getElementById('mainCont').innerHTML = html;
  } catch (err) {
    alert("Error monitor: " + err.message);
    renderUI();
  }
}

async function verPanelIncidencias() {
  detenerScanner();
  fotosSol = {};
  document.getElementById('mainCont').innerHTML =
    '<div class="card center"><h3>Cargando Reportes...</h3><div class="loader" style="display:block"></div></div>';

  try {
    const res = await api("/pendientes");
    const lista = res.data || [];
    let html = '<div class="card"><h3>Reportes Pendientes</h3>';

    if (!lista.length) {
      html += '<p class="center muted">No hay pendientes ✅</p>';
    } else {
      lista.forEach(function(item) {
        html += '<div class="item-pend">';
        html += '<b>' + escapeHtml(item.area) + '</b> <span class="muted">(' + escapeHtml(item.fecha) + ')</span><br>';
        html += '<i>' + escapeHtml(item.desc) + '</i><br>';
        html += '<label for="sol_' + item.fila + '">¿Quién reparó?</label>';
        html += '<input type="text" id="sol_' + item.fila + '" placeholder="Nombre o ID">';
        html += '<button class="btn btn-alt" style="padding:10px; background:#17a2b8;" onclick="document.getElementById(\'fsol_' + item.fila + '\').click()">📸 FOTO SOLUCIÓN</button>';
        html += '<input type="file" id="fsol_' + item.fila + '" accept="image/*" capture="environment" style="display:none" onchange="pFotoSol(this, ' + item.fila + ')">';
        html += '<img id="prev_' + item.fila + '" style="width:100%; display:none; margin-top:8px; border-radius:10px;">';
        html += '<button class="btn btn-main" onclick="solucionar(' + item.fila + ')">SOLUCIONADO</button>';
        html += '</div>';
      });
    }

    html += '<button class="btn btn-sec" onclick="renderUI()">VOLVER</button></div>';
    document.getElementById('mainCont').innerHTML = html;
  } catch (err) {
    alert("Error reportes: " + err.message);
    renderUI();
  }
}

function pFotoSol(input, fila) {
  if (!input.files[0]) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      const scale = Math.min(900 / img.width, 1);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      fotosSol[fila] = canvas.toDataURL('image/jpeg', 0.75);
      document.getElementById('prev_' + fila).src = fotosSol[fila];
      document.getElementById('prev_' + fila).style.display = "block";
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(input.files[0]);
}

async function solucionar(fila) {
  const quien = document.getElementById('sol_' + fila).value.trim();
  if (!quien) return alert("Escribe quién lo reparó");

  document.getElementById('mainCont').innerHTML =
    '<div class="card center"><h3>Guardando...</h3><div class="loader" style="display:block"></div></div>';

  try {
    const res = await api("/solucionar", {
      method: "POST",
      body: JSON.stringify({
        fila,
        quien,
        fotoSol: fotosSol[fila] || ""
      })
    });
    alert(res.msg || "Guardado");
    await verPanelIncidencias();
  } catch (err) {
    alert("Error al guardar: " + err.message);
    renderUI();
  }
}

function pQR(input) {
  if (!input.files[0]) return;

  document.getElementById('mainCont').innerHTML =
    '<div class="card center"><h3>Procesando QR...</h3><div class="loader" style="display:block"></div></div>';

  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1200 / img.width, 1);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, canvas.width, canvas.height);

      if (code && code.data) {
        registrarEntradaQR(code.data);
      } else {
        alert("Código QR no detectado. Intenta con mejor luz o usa cámara en vivo.");
        renderUI();
      }
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(input.files[0]);
}

async function finalizarArea() {
  const n = document.getElementById('nota').value.trim();

  document.getElementById('mainCont').innerHTML =
    '<div class="card center"><h3>Finalizando...</h3><div class="loader" style="display:block"></div></div>';

  try {
    const res = await api("/salida", {
      method: "POST",
      body: JSON.stringify({
        id: u.id,
        nota: n,
        foto: fotoB64
      })
    });

    fotoB64 = "";
    alert(res.msg || "Finalizado");
    await actualizarEstadoInterno();
  } catch (err) {
    alert("Error al finalizar: " + err.message);
    renderUI();
  }
}

async function actualizarEstadoInterno() {
  const res = await api("/refresh", {
    method: "POST",
    body: JSON.stringify({ id: u.id })
  });
  u = res;
  renderUI();
}

function pFoto(input) {
  if (!input.files[0]) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      const scale = Math.min(900 / img.width, 1);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);

      fotoB64 = canvas.toDataURL('image/jpeg', 0.75);
      document.getElementById('preview').src = fotoB64;
      document.getElementById('preview').style.display = "block";
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(input.files[0]);
}

function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
