const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./db');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Initialize Database on Startup
db.initDatabase();

// Route /twareed and / to index.html
app.get(['/twareed', '/twareed/'], (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Health Check API
app.get('/api/health', async (req, res) => {
  res.json({
    status: 'ok',
    database_type: db.getDbType(),
    message: db.getDbType() === 'postgres' 
      ? 'Connected to Live PostgreSQL Server' 
      : 'Running on Local Demo DB (Exportable to PostgreSQL at any time)'
  });
});

// POST /api/auth/signup
app.post('/api/auth/signup', async (req, res) => {
  const { full_name, phone, email, country, city, password } = req.body;

  if (!full_name || !phone || !email || !city || !password) {
    return res.status(400).json({ 
      success: false, 
      message: 'جميع الحقول مطلوبة!' 
    });
  }

  try {
    // Check if email or phone already exists
    const existing = await db.query(
      'SELECT id, email, phone FROM users WHERE LOWER(email) = LOWER($1) OR phone = $2',
      [email.trim(), phone.trim()]
    );

    if (existing.rows.length > 0) {
      const user = existing.rows[0];
      if (user.email.toLowerCase() === email.trim().toLowerCase()) {
        return res.status(409).json({ 
          success: false, 
          message: 'البريد الإلكتروني مسجل مسبقاً!' 
        });
      }
      if (user.phone === phone.trim()) {
        return res.status(409).json({ 
          success: false, 
          message: 'رقم الجوال مسجل مسبقاً!' 
        });
      }
    }

    // Hash password
    const saltRounds = 10;
    const password_hash = await bcrypt.hash(password, saltRounds);

    // Insert user
    const insertSql = `
      INSERT INTO users (full_name, phone, email, country, city, password_hash)
      VALUES ($1, $2, $3, $4, $5, $6)
    `;

    const insertResult = await db.query(insertSql, [
      full_name.trim(),
      phone.trim(),
      email.trim().toLowerCase(),
      country || 'سلطنة عمان',
      city.trim(),
      password_hash
    ]);

    return res.status(201).json({
      success: true,
      message: 'تم إنشاء الحساب وحفظ البيانات في قاعدة البيانات بنجاح!',
      user: {
        id: insertResult.lastID || (insertResult.rows[0] && insertResult.rows[0].id),
        full_name: full_name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        city: city.trim(),
        country: country || 'سلطنة عمان'
      }
    });

  } catch (err) {
    console.error('Signup Error:', err);
    return res.status(500).json({ 
      success: false, 
      message: 'خطأ في قاعدة البيانات: ' + err.message 
    });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { identifier, password } = req.body;

  if (!identifier || !password) {
    return res.status(400).json({ 
      success: false, 
      message: 'يرجى إدخال البريد أو الجوال وكلمة المرور!' 
    });
  }

  try {
    const cleanId = identifier.trim();
    const userResult = await db.query(
      'SELECT * FROM users WHERE LOWER(email) = LOWER($1) OR phone = $2',
      [cleanId, cleanId]
    );

    if (!userResult.rows || userResult.rows.length === 0) {
      return res.status(401).json({ 
        success: false, 
        message: 'بيانات الدخول غير صحيحة!' 
      });
    }

    const user = userResult.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({ 
        success: false, 
        message: 'بيانات الدخول غير صحيحة!' 
      });
    }

    return res.json({
      success: true,
      message: 'تم تسجيل الدخول بنجاح!',
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        phone: user.phone,
        city: user.city,
        country: user.country
      }
    });

  } catch (err) {
    console.error('Login Error:', err);
    return res.status(500).json({ 
      success: false, 
      message: 'خطأ أثناء تسجيل الدخول: ' + err.message 
    });
  }
});

// Export Database Endpoint for the Client
app.get('/api/admin/users', async (req, res) => {
  try {
    const users = await db.query('SELECT id, full_name, phone, email, country, city, created_at FROM users ORDER BY id DESC');
    res.json({
      total_users: users.rows.length,
      users: users.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/products - Parses CSV data excluding supplier details (Col 1 & 2)
const fs = require('fs');
app.get('/api/products', (req, res) => {
  try {
    const csvPath = path.join(__dirname, 'products-details.csv');
    const content = fs.readFileSync(csvPath, 'utf8');
    
    // Fallback images map
    const defaultImages = [
      './products-images/1000137896.png',
      './products-images/1000137891.jpg',
      './products-images/1000137895.jpg'
    ];

    // Simple robust CSV line parser
    const lines = [];
    let currentLine = [];
    let currentField = '';
    let inQuotes = false;

    for (let i = 0; i < content.length; i++) {
      const char = content[i];
      const nextChar = content[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          currentField += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        currentLine.push(currentField);
        currentField = '';
      } else if ((char === '\r' || char === '\n') && !inQuotes) {
        if (char === '\r' && nextChar === '\n') i++;
        currentLine.push(currentField);
        if (currentLine.some(f => f.trim() !== '')) {
          lines.push(currentLine);
        }
        currentLine = [];
        currentField = '';
      } else {
        currentField += char;
      }
    }
    if (currentField || currentLine.length > 0) {
      currentLine.push(currentField);
      if (currentLine.some(f => f.trim() !== '')) {
        lines.push(currentLine);
      }
    }

    if (lines.length <= 1) {
      return res.json([]);
    }

    // Process data rows, strictly omitting index 0 and 1 (Supplier info)
    const products = lines.slice(1).map((row, idx) => {
      return {
        id: idx + 1,
        image: defaultImages[idx] || (row[2] ? row[2].trim() : './products-images/1000137896.png'),
        name_ar: (row[3] || '').trim(),
        name_en: (row[4] || '').trim(),
        name_ur: (row[5] || '').trim(),
        name_hi: (row[6] || '').trim(),
        name_ml: (row[7] || '').trim(),
        serial_number: (row[8] || '').trim(),
        origin_ar: (row[9] || '').trim(),
        origin_en: (row[10] || '').trim(),
        origin_ur: (row[11] || '').trim(),
        origin_hi: (row[12] || '').trim(),
        origin_ml: (row[13] || '').trim(),
        origin: (row[9] || '').trim(),
        price_omr: (row[14] || '').trim().replace(',', '.'),
        quantity: parseInt((row[15] || '0').trim(), 10) || 0
      };
    });

    res.json(products);
  } catch (err) {
    console.error('Error loading products CSV:', err);
    res.status(500).json({ error: 'Failed to parse products' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Twareed Server is running on http://localhost:${PORT}`);
});
