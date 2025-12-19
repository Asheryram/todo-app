const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

/* ==========================
   DATABASE CONNECTION POOL
========================== */

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

/* ==========================
   AUTO-CREATE TABLE
========================== */

async function initDB() {
  try {
    const connection = await pool.getConnection();
    
    const sql = `
      CREATE TABLE IF NOT EXISTS todos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        completed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await connection.query(sql);
    connection.release();
    
    console.log('✅ Connected to AWS RDS');
    console.log('✅ Database initialized (table ready)');
  } catch (err) {
    console.error('❌ RDS connection failed:', err.message);
    console.log('⏳ Retrying in 5 seconds...');
    setTimeout(initDB, 5000);
  }
}

initDB();

/* ==========================
   EC2 METADATA (IMDSv2)
========================== */

async function getMetadata(path) {
  try {
    const tokenRes = await axios.put(
      'http://169.254.169.254/latest/api/token',
      {},
      { 
        headers: { 'X-aws-ec2-metadata-token-ttl-seconds': '21600' },
        timeout: 1000
      }
    );

    const res = await axios.get(
      `http://169.254.169.254/latest/meta-data/${path}`,
      { 
        headers: { 'X-aws-ec2-metadata-token': tokenRes.data },
        timeout: 1000
      }
    );

    return res.data;
  } catch {
    return 'Not available';
  }
}

/* ==========================
   API ROUTES (CRUD)
========================== */

app.get('/api/todos', async (req, res) => {
  try {
    const [results] = await pool.query('SELECT * FROM todos ORDER BY created_at DESC');
    res.json(results);
  } catch (err) {
    console.error('❌ Error fetching todos:', err);
    res.status(500).json({ error: 'Failed to fetch todos' });
  }
});

app.post('/api/todos', async (req, res) => {
  try {
    const { title } = req.body;
    
    if (!title || title.trim() === '') {
      return res.status(400).json({ error: 'Title is required' });
    }

    await pool.query('INSERT INTO todos (title) VALUES (?)', [title.trim()]);
    res.status(201).json({ message: 'Todo added successfully' });
  } catch (err) {
    console.error('❌ Error creating todo:', err);
    res.status(500).json({ error: 'Failed to create todo' });
  }
});

app.put('/api/todos/:id', async (req, res) => {
  try {
    const { completed } = req.body;
    const { id } = req.params;

    if (completed === undefined) {
      return res.status(400).json({ error: 'Completed status is required' });
    }

    const [result] = await pool.query(
      'UPDATE todos SET completed=? WHERE id=?',
      [completed, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Todo not found' });
    }

    res.json({ message: 'Todo updated successfully' });
  } catch (err) {
    console.error('❌ Error updating todo:', err);
    res.status(500).json({ error: 'Failed to update todo' });
  }
});

app.delete('/api/todos/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await pool.query('DELETE FROM todos WHERE id=?', [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Todo not found' });
    }

    res.json({ message: 'Todo deleted successfully' });
  } catch (err) {
    console.error('❌ Error deleting todo:', err);
    res.status(500).json({ error: 'Failed to delete todo' });
  }
});

/* ==========================
   METADATA ENDPOINT
========================== */

app.get('/api/metadata', async (req, res) => {
  try {
    const metadata = {
      instanceId: await getMetadata('instance-id'),
      availabilityZone: await getMetadata('placement/availability-zone'),
      privateIp: await getMetadata('local-ipv4'),
      instanceType: await getMetadata('instance-type'),
      publicIp: await getMetadata('public-ipv4')
    };
    res.json(metadata);
  } catch (err) {
    console.error('❌ Error fetching metadata:', err);
    res.status(500).json({ error: 'Failed to fetch metadata' });
  }
});

/* ==========================
   HEALTH CHECK (ALB)
========================== */

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.get('/dbactive', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'healthy', database: 'connected' });
  } catch (err) {
    console.error('❌ Health check failed:', err);
    res.status(503).json({ status: 'unhealthy', database: 'disconnected' });
  }
});

/* ==========================
   ROOT ENDPOINT
========================== */

app.get('/', (req, res) => {
  res.send('Todo API is running! Visit /api/todos');
});

/* ==========================
   ERROR HANDLER
========================== */

app.use((err, req, res, next) => {
  console.error('❌ Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

/* ==========================
   GRACEFUL SHUTDOWN
========================== */

process.on('SIGTERM', async () => {
  console.log('⚠️ SIGTERM received, closing server...');
  await pool.end();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('⚠️ SIGINT received, closing server...');
  await pool.end();
  process.exit(0);
});

/* ==========================
   START SERVER
========================== */

app.listen(PORT,'0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
});