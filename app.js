const API_URL = "https://script.google.com/a/macros/cap.edu.mx/s/AKfycbxw7qG9PVMtNsVAwvdbm_i_oeG7jb3x4eNErN0CfrxtiBqtPVQ-f76NDqOAxYEDl1DGqw/exec";

let u = {};
let fotoB64 = "";
let fotosSol = {};
let qrScanner = null;
let qrActivo = false;

document.getElementById("btnLogin").addEventListener("click", entrar);

async function api(action, payload = {}) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, ...payload })
  });

  return await res.json();
}

async function entrar() {
  const idV = document.getElementById("id").value.trim();
  const pinV = document.getElementById("pin").value.trim();
  if (!idV || !pinV) return alert("Completa los datos");

  document.getElementById("loadL").style.display = "block";

  try {
    const res = await api("login", { id: idV, pin: pinV });
    document.getElementById("loadL").style.display = "none";

    if (res.success) {
      u = res;
      renderUI();
    } else {
      alert(res.msg || "Error de acceso");
    }
  } catch (err) {
    document.getElementById("loadL").style.display = "none";
    alert("Error de conexión");
  }
}
