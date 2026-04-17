const { onRequest } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const express = require("express");
const admin = require("firebase-admin");
const { google } = require("googleapis");
const { Readable } = require("stream");

admin.initializeApp();

setGlobalOptions({
  region: "us-central1",
  maxInstances: 10
});

const app = express();
app.use(express.json({ limit: "12mb" }));

const SPREADSHEET_ID = "1fwlwchMXkIG4a1Vc2s4tB5R71bLtb8MZvS5SiJt2TV4";
const FOLDER_ID = "11W4U0r528GlftRfKBDQ7l82C7NRosC1w";
const TIME_ZONE = "America/Mexico_City";

const auth = new google.auth.GoogleAuth({
  scopes: [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
  ]
});

async function getSheets() {
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

async function getDrive() {
  const client = await auth.getClient();
  return google.drive({ version: "v3", auth: client });
}

function nowSheetString(date = new Date()) {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);

  const map = {};
  for (const p of parts) {
    map[p.type] = p.value;
  }

  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
}

function hhmm(date = new Date()) {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function toMinutesDiff(startValue, endDate = new Date()) {
  const start = new Date(startValue);
  if (isNaN(start.getTime())) return 0;
  return Math.round((endDate - start) / 60000);
}

function inferRole(idU) {
  return String(idU).includes("SUP") ? "Supervisor" : "Operativo";
}

async function getRange(range) {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range
  });
  return res.data.values || [];
}

async function appendRange(range, values) {
  const sheets = await getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [values]
    }
  });
}

async function batchUpdateRanges(data) {
  const sheets = await getSheets();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data
    }
  });
}

async function uploadBase64Image(dataUrl, fileName) {
  if (!dataUrl || dataUrl.length < 100) return "Sin foto";

  const matches = dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!matches) return "Sin foto";

  const mimeType = matches[1];
  const base64 = matches[2];
  const buffer = Buffer.from(base64, "base64");
  const stream = Readable.from(buffer);

  const drive = await getDrive();
  const createRes = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [FOLDER_ID]
    },
    media: {
      mimeType,
      body: stream
    },
    fields: "id, webViewLink"
  });

  const fileId = createRes.data.id;
  return createRes.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;
}

async function loginEmpleado(id, pin) {
  try {
    const rows = await getRange("Empleados!A:C");
    const idU = String(id || "").trim().toUpperCase();

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      if (
        String(row[0] || "").trim().toUpperCase() === idU &&
        (pin === "BYPASS" || String(row[2] || "") === String(pin))
      ) {
        return {
          success: true,
          nombre: row[1] || "",
          rol: inferRole(idU),
          id: idU,
          pendiente: await buscarPendienteSimple(idU)
        };
      }
    }

    return { success: false, msg: "Credenciales incorrectas" };
  } catch (e) {
    return { success: false, msg: String(e) };
  }
}

async function buscarPendienteSimple(idU) {
  const rows = await getRange("Registro_Actividades!A:K");
  for (let i = rows.length - 1; i >= 1; i--) {
    const row = rows[i] || [];
    if (
      String(row[2] || "").trim().toUpperCase() === idU &&
      String(row[9] || "") === "En Proceso"
    ) {
      return { area: row[3] || "" };
    }
  }
  return null;
}

async function procesarEntrada(id, qr) {
  const now = new Date();
  const nowStr = nowSheetString(now);

  await appendRange("Registro_Actividades!A:K", [
    `REG-${now.getTime()}`,
    nowStr,
    id,
    qr,
    nowStr,
    "",
    "",
    "Ciclo",
    "",
    "En Proceso",
    ""
  ]);

  return { success: true, msg: `¡A trabajar! Registrado en: ${qr}` };
}

async function procesarSalida(id, nota, foto) {
  const rows = await getRange("Registro_Actividades!A:K");
  const now = new Date();
  const nowStr = nowSheetString(now);

  for (let i = rows.length - 1; i >= 1; i--) {
    const row = rows[i] || [];
    if (
      String(row[2] || "").trim().toUpperCase() === String(id).trim().toUpperCase() &&
      String(row[9] || "") === "En Proceso"
    ) {
      const area = row[3] || "";
      const duracion = toMinutesDiff(row[4], now);
      const urlFoto = await uploadBase64Image(foto, `Evid_${Date.now()}.jpg`);
      const rowNumber = i + 1;

      await batchUpdateRanges([
        { range: `Registro_Actividades!F${rowNumber}`, values: [[nowStr]] },
        { range: `Registro_Actividades!G${rowNumber}`, values: [[duracion]] },
        { range: `Registro_Actividades!I${rowNumber}`, values: [[nota || ""]] },
        { range: `Registro_Actividades!J${rowNumber}`, values: [["Finalizado"]] },
        { range: `Registro_Actividades!K${rowNumber}`, values: [[urlFoto]] }
      ]);

      if (nota && String(nota).trim() !== "") {
        await appendRange("Reportes_Incidencias!A:I", [
          nowStr,
          area,
          nota,
          id,
          "Pendiente",
          urlFoto,
          "",
          "",
          ""
        ]);
      }

      return {
        success: true,
        msg: `✅ Área terminada.\nDuración: ${duracion} minutos.`
      };
    }
  }

  return { success: false, msg: "No se encontró actividad en proceso." };
}

async function obtenerReportesPendientes() {
  try {
    const rows = await getRange("Reportes_Incidencias!A:I");
    const pendientes = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      if (String(row[4] || "").trim() === "Pendiente") {
        pendientes.push({
          fila: i + 1,
          fecha: String(row[0] || ""),
          area: row[1] || "",
          desc: row[2] || ""
        });
      }
    }

    return pendientes;
  } catch {
    return [];
  }
}

async function actualizarReporte({ fila, quien, fotoSol }) {
  try {
    const nowStr = nowSheetString(new Date());
    const urlFotoSol = await uploadBase64Image(fotoSol, `Solucion_${Date.now()}.jpg`);

    await batchUpdateRanges([
      { range: `Reportes_Incidencias!E${fila}`, values: [["Solucionado"]] },
      { range: `Reportes_Incidencias!G${fila}`, values: [[nowStr]] },
      { range: `Reportes_Incidencias!H${fila}`, values: [[quien]] },
      { range: `Reportes_Incidencias!I${fila}`, values: [[urlFotoSol]] }
    ]);

    return { success: true, msg: "✅ Reporte solucionado con evidencia." };
  } catch (e) {
    return { success: false, msg: String(e) };
  }
}

async function obtenerEstadoMonitor() {
  try {
    const empRows = await getRange("Empleados!A:B");
    const areaRows = await getRange("Configuracion_Areas!A:B");
    const regRows = await getRange("Registro_Actividades!A:K");

    const dictEmp = {};
    const dictAreas = {};

    for (let i = 1; i < empRows.length; i++) {
      const row = empRows[i] || [];
      dictEmp[String(row[0] || "").trim().toUpperCase()] = row[1] || "";
    }

    for (let i = 1; i < areaRows.length; i++) {
      const row = areaRows[i] || [];
      dictAreas[String(row[0] || "").trim()] = row[1] || "";
    }

    const activosHoy = {};
    const monitor = [];
    const now = new Date();

    for (let i = 1; i < regRows.length; i++) {
      const row = regRows[i] || [];
      if (String(row[9] || "") === "En Proceso") {
        const idEmp = String(row[2] || "").trim().toUpperCase();
        const codArea = String(row[3] || "").trim();
        const inicioValue = row[4] || "";
        const mins = toMinutesDiff(inicioValue, now);

        activosHoy[idEmp] = true;

        monitor.push({
          nombre: dictEmp[idEmp] || idEmp,
          area: dictAreas[codArea] || codArea,
          inicio: inicioValue ? hhmm(new Date(inicioValue)) : "--:--",
          tiempo: mins,
          estado: "TRABAJANDO",
          alerta: mins > 45 ? "🔴 EXCESIVO" : mins > 30 ? "🟡 ATENCIÓN" : "🟢 OK"
        });
      }
    }

    for (const id in dictEmp) {
      if (!activosHoy[id] && !id.includes("SUP")) {
        monitor.push({
          nombre: dictEmp[id],
          area: "Sin actividad",
          inicio: "--:--",
          tiempo: 0,
          estado: "LIBRE / COMIDA",
          alerta: "⚪"
        });
      }
    }

    return monitor;
  } catch {
    return [];
  }
}

app.get("/health", async (req, res) => {
  res.json({ ok: true, service: "Bitacora CAP API", time: new Date().toISOString() });
});

app.post("/login", async (req, res) => {
  res.json(await loginEmpleado(req.body.id, req.body.pin));
});

app.post("/refresh", async (req, res) => {
  res.json(await loginEmpleado(req.body.id, "BYPASS"));
});

app.post("/entrada", async (req, res) => {
  res.json(await procesarEntrada(req.body.id, req.body.qr));
});

app.post("/salida", async (req, res) => {
  res.json(await procesarSalida(req.body.id, req.body.nota || "", req.body.foto || ""));
});

app.get("/monitor", async (req, res) => {
  res.json({ success: true, data: await obtenerEstadoMonitor() });
});

app.get("/pendientes", async (req, res) => {
  res.json({ success: true, data: await obtenerReportesPendientes() });
});

app.post("/solucionar", async (req, res) => {
  res.json(await actualizarReporte({
    fila: req.body.fila,
    quien: req.body.quien,
    fotoSol: req.body.fotoSol || ""
  }));
});

exports.api = onRequest(
  {
    cors: true,
    timeoutSeconds: 120,
    memory: "512MiB"
  },
  app
);
