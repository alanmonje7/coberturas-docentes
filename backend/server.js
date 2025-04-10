// server.js completo con funcionalidad para eliminar alertas
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const SibApiV3Sdk = require('@sendinblue/client');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const db = new sqlite3.Database('./db.sqlite');

// Brevo (Sendinblue) config
const brevoClient = new SibApiV3Sdk.TransactionalEmailsApi();
brevoClient.setApiKey(SibApiV3Sdk.TransactionalEmailsApiApiKeys.apiKey, 'TU_API_KEY_BREVO');

function enviarCorreo(destinatario, asunto, contenido) {
  const email = {
    sender: { name: 'Coberturas Docentes', email: 'coordinacion@leonxiii.edu.ar' },
    to: [{ email: destinatario }],
    subject: asunto,
    htmlContent: `<html><body><p>${contenido}</p></body></html>`
  };

  brevoClient.sendTransacEmail(email).then(
    () => console.log(`✉️ Email enviado a ${destinatario}`),
    (err) => console.error('❌ Error al enviar email:', err)
  );
}

app.post('/login', (req, res) => {
  const { dni } = req.body;
  db.get("SELECT * FROM docentes WHERE dni = ?", [dni], (err, docente) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!docente) return res.status(404).json({ error: 'Docente no encontrado' });
    res.json({ docente });
  });
});

app.post('/admin-login', (req, res) => {
  const { dni, clave } = req.body;
  if (dni === '38504641' && clave === '3850464100') {
    res.json({ ok: true });
  } else {
    res.status(401).json({ ok: false });
  }
});

app.post('/registro', (req, res) => {
  const { dni, nombre, apellido, email } = req.body;
  db.get("SELECT * FROM docentes WHERE nombre = ? AND apellido = ?", [nombre, apellido], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: "Nombre y apellido no encontrados en la base." });
    db.run("UPDATE docentes SET dni = ?, email = ? WHERE id = ?", [dni, email, row.id], function(err2) {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json({ ok: true });
    });
  });
});

app.post('/reportar-falta', (req, res) => {
  const { dia, hora, curso, materia, docente_faltante } = req.body;
  db.run("INSERT INTO alertas (dia, hora, curso, materia, docente_faltante) VALUES (?, ?, ?, ?, ?)",
    [dia, hora, curso, materia, docente_faltante], function(err) {
      if (err) return res.status(500).json({ error: err.message });

      db.all(`
        SELECT d.nombre, d.apellido, d.email
        FROM docentes d
        JOIN horarios h ON d.id = h.docente_id
        WHERE h.dia = ? AND h.hora = ?
      `, [dia, hora], (err2, disponibles) => {
        if (!err2 && disponibles.length) {
          disponibles.forEach(docente => {
            if (docente.email) {
              const mensaje = `
                ¡Hola ${docente.nombre} ${docente.apellido}!<br><br>
                Hay una hora libre en el curso <strong>${curso}</strong> para la materia <strong>${materia}</strong>
                el día <strong>${dia}</strong> a la hora <strong>${hora}</strong>.<br><br>
                Ingresá a la app para aceptar la cobertura.
              `;
              enviarCorreo(docente.email, 'Nueva cobertura disponible', mensaje);
            }
          });
        }
      });

      res.json({ ok: true });
    });
});

app.post('/confirmar-cobertura', (req, res) => {
  const { alerta_id, docente_id } = req.body;
  db.run("UPDATE alertas SET cubierta_por_id = ? WHERE id = ?", [docente_id, alerta_id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true });
  });
});

app.get('/alertas-todas', (req, res) => {
  const query = `
    SELECT a.*, d.nombre AS cubierta_por_nombre
    FROM alertas a
    LEFT JOIN docentes d ON a.cubierta_por_id = d.id
    ORDER BY a.id DESC
  `;
  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ alertas: rows });
  });
});

app.get('/alertas-disponibles', (req, res) => {
  db.all("SELECT * FROM alertas WHERE cubierta_por_id IS NULL ORDER BY id DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ alertas: rows });
  });
});

app.delete('/alerta/:id', (req, res) => {
    const id = req.params.id;
    db.run("DELETE FROM alertas WHERE id = ?", [id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ ok: true });
    });
  });
  
  

app.get('/horario/:dni', (req, res) => {
  const dni = req.params.dni;
  db.get("SELECT id FROM docentes WHERE dni = ?", [dni], (err, row) => {
    if (err || !row) return res.status(404).json({ error: "Docente no encontrado" });
    db.all("SELECT * FROM horarios WHERE docente_id = ?", [row.id], (err2, horarios) => {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json({ horarios });
    });
  });
});

app.get('/coberturas-sugeridas/:dni', (req, res) => {
  const dni = req.params.dni;
  db.get("SELECT id FROM docentes WHERE dni = ?", [dni], (err, docente) => {
    if (err || !docente) return res.status(404).json({ error: "Docente no encontrado" });

    db.all("SELECT dia, hora FROM horarios WHERE docente_id = ?", [docente.id], (err2, horarios) => {
      if (err2) return res.status(500).json({ error: err2.message });

      const condiciones = horarios.map(h => `(dia = '${h.dia}' AND hora = ${h.hora})`).join(" OR ");
      if (!condiciones) return res.json({ sugerencias: [] });

      const query = `SELECT * FROM alertas WHERE cubierta_por_id IS NULL AND (${condiciones})`;
      db.all(query, [], (err3, alertas) => {
        if (err3) return res.status(500).json({ error: err3.message });
        res.json({ sugerencias: alertas });
      });
    });
  });
});

app.listen(3001, () => {
  console.log('Servidor backend iniciado en http://localhost:3001');
});
