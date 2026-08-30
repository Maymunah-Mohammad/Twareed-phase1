/**
 * Twareed Hybrid Database Layer
 * Supports PostgreSQL (for production/client servers) and local SQLite (for seamless zero-setup demo).
 */
const { Pool } = require('pg');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
require('dotenv').config();

let dbType = 'sqlite'; // 'postgres' or 'sqlite'
let pgPool = null;
let sqliteDb = null;

// Determine if valid PostgreSQL URL is supplied
const postgresUrl = process.env.DATABASE_URL;

if (postgresUrl && postgresUrl.startsWith('postgres') && !postgresUrl.includes('localhost:5432/twareed_db')) {
  dbType = 'postgres';
  pgPool = new Pool({
    connectionString: postgresUrl,
    ssl: postgresUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : false
  });
} else {
  dbType = 'sqlite';
  const dbPath = path.join(__dirname, 'twareed_demo.sqlite');
  sqliteDb = new sqlite3.Database(dbPath);
}

// Universal Query Helper
async function query(sql, params = []) {
  if (dbType === 'postgres') {
    return await pgPool.query(sql, params);
  }

  // SQLite adapter (convert $1, $2 to ? for SQLite compatibility)
  return new Promise((resolve, reject) => {
    const sqliteSql = sql.replace(/\$\d+/g, '?');

    // Handle SELECT queries
    if (/^\s*SELECT/i.test(sqliteSql)) {
      sqliteDb.all(sqliteSql, params, (err, rows) => {
        if (err) return reject(err);
        resolve({ rows: rows || [], rowCount: (rows || []).length });
      });
    } else {
      // Handle INSERT / UPDATE / DELETE
      sqliteDb.run(sqliteSql, params, function (err) {
        if (err) return reject(err);
        resolve({
          rows: [{ id: this.lastID }],
          rowCount: this.changes,
          lastID: this.lastID
        });
      });
    }
  });
}

// Database Initializer
async function initDatabase() {
  if (dbType === 'postgres') {
    try {
      const client = await pgPool.connect();
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          full_name VARCHAR(255) NOT NULL,
          phone VARCHAR(50) NOT NULL UNIQUE,
          email VARCHAR(255) NOT NULL UNIQUE,
          country VARCHAR(100) DEFAULT 'سلطنة عمان',
          city VARCHAR(100) NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_users_email ON users(LOWER(email));
        CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
      `);
      client.release();
      console.log('✅ Connected to PostgreSQL Database');
    } catch (err) {
      console.warn('⚠️ PostgreSQL connection failed, falling back to local demo database:', err.message);
      dbType = 'sqlite';
      const dbPath = path.join(__dirname, 'twareed_demo.sqlite');
      sqliteDb = new sqlite3.Database(dbPath);
      await initSqlite();
    }
  } else {
    await initSqlite();
  }
}

function initSqlite() {
  return new Promise((resolve, reject) => {
    sqliteDb.serialize(() => {
      sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          full_name TEXT NOT NULL,
          phone TEXT NOT NULL UNIQUE,
          email TEXT NOT NULL UNIQUE,
          country TEXT DEFAULT 'سلطنة عمان',
          city TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) return reject(err);
        console.log('✅ Local Database ready: twareed_demo.sqlite (Stores all signups locally & ready to export to PostgreSQL)');
        resolve();
      });
    });
  });
}

module.exports = {
  query,
  initDatabase,
  getDbType: () => dbType
};
