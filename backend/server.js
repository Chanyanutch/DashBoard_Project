const express = require('express');
const sql = require('mssql');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

const dbConfig = {
  server: process.env.DB_SERVER || 'localhost',
  database: process.env.DB_NAME || 'ETL',
  user: process.env.DB_USER || 'Chanya',
  password: process.env.DB_PASSWORD || 'Chanya@123',
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};

const positivePayment = `
  CASE
    WHEN total_payment > 0 THEN total_payment
    ELSE 0
  END
`;

const positiveFactPayment = `
  CASE
    WHEN fr.total_payment > 0 THEN fr.total_payment
    ELSE 0
  END
`;

async function runQuery(res, query) {
  try {
    const pool = await sql.connect(dbConfig);
    const result = await pool.request().query(query);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

app.get('/api/dashboard/summary', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig);

    const result = await pool.request().query(`
      SELECT
        ISNULL(SUM(${positivePayment}), 0) AS totalRevenue,
        ISNULL(SUM(balance), 0) AS totalDebt,
        ISNULL(SUM(total_charge), 0) AS totalCharge,
        CASE
          WHEN ISNULL(SUM(total_charge), 0) = 0 THEN 0
          ELSE ROUND(SUM(${positivePayment}) * 100.0 / SUM(total_charge), 2)
        END AS paymentRate
      FROM Fact_revenue;
    `);

    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/dashboard/revenue-chart', async (req, res) => {
  const { year, month } = req.query;

  const labelColumn = month
    ? `CONVERT(VARCHAR(10), dt.[date], 120) AS label`
    : `CONCAT(dt.[month], '/', dt.[year]) AS label`;

  let query = `
    SELECT
      ${labelColumn},
      MIN(dt.[date]) AS sort_date,
      ISNULL(SUM(${positiveFactPayment}), 0) AS revenue,
      ISNULL(SUM(fr.balance), 0) AS debt
    FROM Fact_revenue fr
    JOIN dim_time dt
      ON fr.time_id = dt.time_id
    WHERE 1=1
  `;

  if (year) {
    query += ` AND dt.[year] = ${Number(year)}`;
  }

  if (month) {
    query += ` AND dt.[month] = ${Number(month)}`;
  }

  query += month
    ? ` GROUP BY dt.[date] ORDER BY sort_date`
    : ` GROUP BY dt.[year], dt.[month] ORDER BY sort_date`;

  await runQuery(res, query);
});

app.get('/api/dashboard/top-services', async (req, res) => {
  try {
    const { year, month } = req.query;
    const pool = await sql.connect(dbConfig);

    let query = `
      SELECT TOP 3
        dl.list_name AS serviceName,
        ISNULL(SUM(${positiveFactPayment}), 0) AS totalRevenue,
        ISNULL(SUM(fr.balance), 0) AS totalDebt
      FROM Fact_revenue fr
      JOIN dim_list dl
        ON fr.list_id = dl.list_id
      JOIN dim_time dt
        ON fr.time_id = dt.time_id
      WHERE 1=1
    `;

    if (year) {
      query += ` AND dt.[year] = ${Number(year)}`;
    }

    if (month) {
      query += ` AND dt.[month] = ${Number(month)}`;
    }

    query += `
      GROUP BY dl.list_name
      ORDER BY totalRevenue DESC;
    `;

    const result = await pool.request().query(query);
    res.json(result.recordset);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }

});

app.get('/api/dashboard/other-services', async (req, res) => {
  try {
    const { year, month } = req.query;
    const pool = await sql.connect(dbConfig);

    let query = `
      WITH service_rank AS (
        SELECT
          dl.list_name AS serviceName,
          ISNULL(SUM(${positiveFactPayment}), 0) AS totalRevenue,
          ISNULL(SUM(fr.balance), 0) AS totalDebt,
          ROW_NUMBER() OVER (
            ORDER BY ISNULL(SUM(${positiveFactPayment}), 0) DESC
          ) AS rankNo
        FROM Fact_revenue fr
        JOIN dim_list dl
          ON fr.list_id = dl.list_id
        JOIN dim_time dt
          ON fr.time_id = dt.time_id
        WHERE 1=1
    `;

    if (year) {
      query += ` AND dt.[year] = ${Number(year)}`;
    }

    if (month) {
      query += ` AND dt.[month] = ${Number(month)}`;
    }

    query += `
        GROUP BY dl.list_name
      )
      SELECT
        serviceName,
        totalRevenue,
        totalDebt,
        rankNo
      FROM service_rank
      WHERE rankNo > 3
      ORDER BY rankNo;
    `;

    const result = await pool.request().query(query);
    res.json(result.recordset);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/dashboard/status-summary', async (req, res) => {
  try {
    const { year, month } = req.query;
    const pool = await sql.connect(dbConfig);

    let query = `
      SELECT
        ps.payment_status AS status,
        COUNT(*) AS total
      FROM Fact_revenue fr
      JOIN dim_payment_status ps
        ON fr.payment_status_id = ps.payment_status_id
      JOIN dim_time dt
        ON fr.time_id = dt.time_id
      WHERE 1=1
    `;

    if (year) {
      query += ` AND dt.[year] = ${Number(year)}`;
    }

    if (month) {
      query += ` AND dt.[month] = ${Number(month)}`;
    }

    query += `
      GROUP BY ps.payment_status;
    `;

    const result = await pool.request().query(query);
    res.json(result.recordset);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/dashboard/accounting-summary', async (req, res) => {
  try {
    const { year, month } = req.query;
    const pool = await sql.connect(dbConfig);

    let query = `
      SELECT
        ISNULL(SUM(fa.debit), 0) AS totalDebit,
        ISNULL(SUM(fa.credit), 0) AS totalCredit
      FROM Fact_accounting fa
      JOIN dim_time dt
        ON fa.time_id = dt.time_id
      WHERE 1=1
    `;

    if (year) {
      query += ` AND dt.[year] = ${Number(year)}`;
    }

    if (month) {
      query += ` AND dt.[month] = ${Number(month)}`;
    }

    const result = await pool.request().query(query);
    res.json(result.recordset[0]);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/dashboard/years', async (req, res) => {
  const query = `
    SELECT DISTINCT
      [year] AS year
    FROM dim_time
    ORDER BY [year] DESC;
  `;

  await runQuery(res, query);
});

app.listen(3000, () => {
  console.log('Backend running on http://localhost:3000');
});