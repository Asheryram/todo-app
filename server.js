const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

/* ==========================
   DATABASE CONNECTION
========================== */

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306
});

function connectDB() {
  db.connect(err => {
    if (err) {
      console.error('❌ RDS connection failed. Retrying in 5 seconds...');
      setTimeout(connectDB, 5000);
      return;
    }
    console.log('✅ Connected to AWS RDS');
    initDB();
  });
}

/* ==========================
   AUTO-CREATE TABLE
========================== */

function initDB() {
  const sql = `
    CREATE TABLE IF NOT EXISTS todos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      completed BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  db.query(sql, err => {
    if (err) {
      console.error('❌ Failed to initialize database:', err);
      return;
    }
    console.log('✅ Database initialized (table ready)');
  });
}

connectDB();

/* ==========================
   EC2 METADATA (IMDSv2)
========================== */

async function getMetadata(path) {
  try {
    const tokenRes = await axios.put(
      'http://169.254.169.254/latest/api/token',
      {},
      { headers: { 'X-aws-ec2-metadata-token-ttl-seconds': '21600' } }
    );

    const res = await axios.get(
      `http://169.254.169.254/latest/meta-data/${path}`,
      { headers: { 'X-aws-ec2-metadata-token': tokenRes.data } }
    );

    return res.data;
  } catch {
    return 'N/A';
  }
}

/* ==========================
   API ROUTES (CRUD)
========================== */

app.get('/api/todos', (req, res) => {
  db.query('SELECT * FROM todos', (err, results) => {
    if (err) return res.status(500).json(err);
    res.json(results);
  });
});

app.post('/api/todos', (req, res) => {
  const { title } = req.body;
  db.query(
    'INSERT INTO todos (title) VALUES (?)',
    [title],
    err => {
      if (err) return res.status(500).json(err);
      res.json({ message: 'Todo added' });
    }
  );
});

app.put('/api/todos/:id', (req, res) => {
  const { completed } = req.body;
  db.query(
    'UPDATE todos SET completed=? WHERE id=?',
    [completed, req.params.id],
    err => {
      if (err) return res.status(500).json(err);
      res.json({ message: 'Todo updated' });
    }
  );
});

app.delete('/api/todos/:id', (req, res) => {
  db.query(
    'DELETE FROM todos WHERE id=?',
    [req.params.id],
    err => {
      if (err) return res.status(500).json(err);
      res.json({ message: 'Todo deleted' });
    }
  );
});

/* ==========================
   METADATA ENDPOINT
========================== */

app.get('/api/metadata', async (req, res) => {
  res.json({
    instanceId: await getMetadata('instance-id'),
    availabilityZone: await getMetadata('placement/availability-zone'),
    privateIp: await getMetadata('local-ipv4')
  });
});

/* ==========================
   HEALTH CHECK (ALB)
========================== */

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

/* ==========================
   START SERVER
========================== */

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
