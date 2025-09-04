const express = require("express");
const mysqlConnection = require("../utils/database.js");
const Router = express.Router();

Router.use(express.json());
const bodyParser = require("body-parser");
Router.use(bodyParser.json());
Router.use(bodyParser.urlencoded({ extended: true }));
const methodOverride = require("method-override");
Router.use(methodOverride("_method"));

// routes/qb.js (inside your Router file)
const util = require('util');
const query = util.promisify(mysqlConnection.query).bind(mysqlConnection);

/**
 * GET /search?q=term[&page=1]
 * - Looks across: signUp, deposit, withdrawals, user_settings
 * - Ranks: prefix match > contains > recency (for money tables)
 * - Pagination: 50 per page (optional)
 */
Router.get('/search', async (req, res) => {
  const qRaw = (req.query.q || '').trim();
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const PAGE_SIZE = 50;
  const OFFSET = (page - 1) * PAGE_SIZE;

  // No query -> empty results page
  if (!qRaw) {
    return res.render('search', {
      title: 'Search',
      q: '',
      users: [],
      deposits: [],
      withdrawals: [],
      settings: []
    });
  }

  // Build patterns
  const prefix = `${qRaw}%`;
  const like   = `%${qRaw}%`;
  const isNum  = /^\d+$/.test(qRaw);
  const num    = isNum ? Number(qRaw) : null;

  try {
    // --- Users (signUp) ---
    // If query is a number, only match id
    const users = await query(
      `
      SELECT id, username, email, phone_number, COALESCE(balance,0) AS balance, password_hash, vip_status, credit_score, created_at
      FROM signUp
      WHERE ${isNum ? 'id = ?' : 'username LIKE ? OR username LIKE ? OR email LIKE ? OR phone_number LIKE ?'}
      ORDER BY
        CASE WHEN username LIKE ? THEN 2
             WHEN username LIKE ? THEN 1
             ELSE 0 END DESC,
        id DESC
      LIMIT ? OFFSET ?
      `,
      isNum
        ? [num, prefix, like, PAGE_SIZE, OFFSET]
        : [prefix, like, like, like,         prefix, like, PAGE_SIZE, OFFSET]
    );

  // --- Deposits removed ---
  const deposits = [];

    // --- Withdrawals (withdrawals + signUp) ---
    // If query is a number, only match withdraw_id or user_id
    const withdrawals = await query(
      `
      SELECT w.withdraw_id,
             w.id AS user_id,
             s.username,
             w.amount, w.method, w.created_at, w.status, w.holderName, w.phoneNumber, w.cryptoId
      FROM withdrawals w
      LEFT JOIN signUp s ON s.id = w.id
      WHERE ${isNum ? 'w.withdraw_id = ? OR w.id = ?' : 's.username LIKE ? OR w.method LIKE ?'}
      ORDER BY
        GREATEST(
          CASE WHEN s.username LIKE ? THEN 2 WHEN s.username LIKE ? THEN 1 ELSE 0 END,
          CASE WHEN w.method   LIKE ? THEN 2 WHEN w.method   LIKE ? THEN 1 ELSE 0 END
        ) DESC,
        w.created_at DESC
      LIMIT ? OFFSET ?
      `,
      isNum
        ? [num, num, prefix, like, prefix, like, PAGE_SIZE, OFFSET]
        : [like, like,          prefix, like, prefix, like, PAGE_SIZE, OFFSET]
    );

    // --- Lucky Orders (lucky_orders + signUp) ---
    // If query is a number, only match id or user_id or order_number
    const settings = await query(
      `
      SELECT lo.id, lo.user_id, s.username, lo.order_number, lo.is_claimed, lo.created_at
      FROM lucky_orders lo
      JOIN signUp s ON s.id = lo.user_id
      WHERE ${isNum ? 'lo.id = ? OR lo.user_id = ? OR lo.order_number = ?' : 's.username LIKE ?'}
      ORDER BY lo.created_at DESC
      LIMIT ? OFFSET ?
      `,
      isNum
        ? [num, num, num, PAGE_SIZE, OFFSET]
        : [like, PAGE_SIZE, OFFSET]
    );

    return res.render('search', {
      title: `Search: ${qRaw}`,
      q: qRaw,
      users,
      deposits, // will be empty
      withdrawals,
      settings,
      page,
      pageSize: PAGE_SIZE
    });
  } catch (err) {
    console.error('Search route error:', err);
    return res.status(500).render('search', {
      title: `Search: ${qRaw}`,
      q: qRaw,
      users: [],
      deposits: [],
      withdrawals: [],
      settings: [],
      page,
      pageSize: PAGE_SIZE
    });
  }
});

/* ---------------- USER (signUp) CRUD ---------------- */

// View all users
Router.get("/users", (req, res) => {
  mysqlConnection.query("SELECT * FROM signUp", (err, results) => {
    if (!err) {
      res.render("users", { title: "Users", users: results });
    } else {
      console.error(err);
      res.status(500).json({ message: "Error fetching users" });
    }
  });
});

// Add user form
Router.get("/users/add", (req, res) => {
  res.render("addUser", { title: "Add User" });
});

// Add user
Router.post("/users/add", (req, res) => {
  const { username, phone_number, email, password_hash, vip_status, credit_score } = req.body;
  const sql = `INSERT INTO signUp (username, phone_number, email, password_hash, vip_status, credit_score) VALUES (?, ?, ?, ?, ?, ?)`;
  mysqlConnection.query(sql, [username, phone_number, email, password_hash, vip_status, credit_score], (err, result) => {
    if (!err) {
      res.redirect("/users");
    } else {
      console.error(err);
      res.status(500).json({ message: "Error adding user" });
    }
  });
});

// Edit user form
Router.get("/users/edit/:id", (req, res) => {
  const id = req.params.id;
  mysqlConnection.query("SELECT * FROM signUp WHERE id = ?", [id], (err, result) => {
    if (!err && result.length > 0) {
      res.render("editUser", { title: "Edit User", user: result[0] });
    } else {
      res.status(404).json({ message: "User not found" });
    }
  });
});

// Update user
Router.post("/users/edit/:id", (req, res) => {
  const id = req.params.id;
  const { username, phone_number, email, balance,password_hash, vip_status, credit_score } = req.body;
  const sql = "UPDATE signUp SET username = ?, phone_number = ?, email = ?, balance = ?, password_hash = ?, vip_status = ?, credit_score = ? WHERE id = ?";
  mysqlConnection.query(sql, [username, phone_number, email, balance,password_hash, vip_status, credit_score, id], (err) => {
    if (!err) {
      res.redirect("/users");
    } else {
      console.error(err);
      res.status(500).json({ message: "Error updating user" });
    }
  });
});

// Delete user
Router.get("/users/delete/:id", (req, res) => {
  const id = req.params.id;
  mysqlConnection.query("DELETE FROM signUp WHERE id = ?", [id], (err) => {
    if (!err) {
      res.redirect("/users");
    } else {
      console.error(err);
      res.status(500).json({ message: "Error deleting user" });
    }
  });
});


/* ---------------- WITHDRAWALS CRUD ---------------- */

// View all withdrawals
Router.get("/withdrawals", (req, res) => {
  mysqlConnection.query("SELECT * FROM withdrawals", (err, results) => {
    if (!err) {
      res.render("withdrawals", { title: "Withdrawals", withdrawals: results });
    } else {
      console.error(err);
      res.status(500).json({ message: "Error fetching withdrawals" });
    }
  });
});

// Add withdrawal form
Router.get("/withdrawals/add", (req, res) => {
  res.render("addWithdrawal", { title: "Add Withdrawal" });
});

// Add withdrawal
Router.post("/withdrawals/add", (req, res) => {
  const { id, amount, method, account } = req.body;
  const sql = `INSERT INTO withdrawals (id, amount, method, account) VALUES (?, ?, ?, ?)`;
  mysqlConnection.query(sql, [id, amount, method, account], (err) => {
    if (!err) {
      res.redirect("/withdrawals");
    } else {
      console.error(err);
      res.status(500).json({ message: "Error adding withdrawal" });
    }
  });
});

// Edit withdrawal form
Router.get("/withdrawals/edit/:withdraw_id", (req, res) => {
  const withdraw_id = req.params.withdraw_id;
  mysqlConnection.query("SELECT * FROM withdrawals WHERE withdraw_id = ?", [withdraw_id], (err, result) => {
    if (!err && result.length > 0) {
      res.render("editWithdrawal", { title: "Edit Withdrawal", withdrawal: result[0] });
    } else {
      res.status(404).json({ message: "Withdrawal not found" });
    }
  });
});

// Update withdrawal
Router.post("/withdrawals/edit/:withdraw_id", (req, res) => {
  const withdraw_id = req.params.withdraw_id;
  const { amount, method, account } = req.body;
  const sql = `UPDATE withdrawals SET amount = ?, method = ?, account = ? WHERE withdraw_id = ?`;
  mysqlConnection.query(sql, [amount, method, account, withdraw_id], (err) => {
    if (!err) {
      res.redirect("/withdrawals");
    } else {
      console.error(err);
      res.status(500).json({ message: "Error updating withdrawal" });
    }
  });
});

// Delete withdrawal
Router.get("/withdrawals/delete/:withdraw_id", (req, res) => {
  const withdraw_id = req.params.withdraw_id;
  mysqlConnection.query("DELETE FROM withdrawals WHERE withdraw_id = ?", [withdraw_id], (err) => {
    if (!err) {
      res.redirect("/withdrawals");
    } else {
      console.error(err);
      res.status(500).json({ message: "Error deleting withdrawal" });
    }
  });
});

// Approve withdrawal (reduce balance only here)
Router.post("/withdrawals/approve/:withdraw_id", (req, res) => {
  const withdraw_id = req.params.withdraw_id;
  mysqlConnection.query(
    "SELECT id, amount, status FROM withdrawals WHERE withdraw_id = ?",
    [withdraw_id],
    (err, results) => {
      if (err || results.length === 0) {
        return res.status(404).json({ message: "Withdrawal not found" });
      }
      const { id, amount, status } = results[0];
      if (status !== 'pending') {
        return res.status(400).json({ message: "Withdrawal already processed" });
      }
      mysqlConnection.query(
        "SELECT balance FROM signUp WHERE id = ?",
        [id],
        (err2, userResults) => {
          if (err2 || userResults.length === 0) {
            return res.status(404).json({ message: "User not found" });
          }
          const balance = parseFloat(userResults[0].balance);
          if (balance < amount) {
            return res.status(400).json({ message: "Insufficient balance" });
          }
          mysqlConnection.query(
            "UPDATE signUp SET balance = balance - ? WHERE id = ?",
            [amount, id],
            (err3) => {
              if (err3) {
                return res.status(500).json({ message: "Error updating balance" });
              }
              mysqlConnection.query(
                "UPDATE withdrawals SET status = 'approved' WHERE withdraw_id = ?",
                [withdraw_id],
                (err4) => {
                  if (err4) {
                    return res.status(500).json({ message: "Error approving withdrawal" });
                  }
                  res.redirect("/withdrawals");
                }
              );
            }
          );
        }
      );
    }
  );
});

// Reject withdrawal
Router.post("/withdrawals/reject/:withdraw_id", (req, res) => {
  const withdraw_id = req.params.withdraw_id;
  mysqlConnection.query(
    "UPDATE withdrawals SET status = 'rejected' WHERE withdraw_id = ?",
    [withdraw_id],
    (err) => {
      if (!err) {
        res.redirect("/withdrawals");
      } else {
        console.error(err);
        res.status(500).json({ message: "Error rejecting withdrawal" });
      }
    }
  );
});


/* ---------------- DEPOSITS CRUD ---------------- */

// View all deposits
Router.get("/deposits", (req, res) => {
  mysqlConnection.query("SELECT * FROM deposit", (err, results) => {
    if (!err) {
      res.render("deposits", { title: "Deposits", deposits: results });
    } else {
      console.error(err);
      res.status(500).json({ message: "Error fetching deposits" });
    }
  });
});

// Add deposit form
Router.get("/deposits/add", (req, res) => {
  res.render("addDeposit", { title: "Add Deposit" });
});

// Add deposit
Router.post("/deposits/add", (req, res) => {
  const { id, amount, method, account } = req.body;
  const sql = `INSERT INTO deposit (id, amount, method, account) VALUES (?, ?, ?, ?)`;
  mysqlConnection.query(sql, [id, amount, method, account], (err) => {
    if (!err) {
      res.redirect("/deposits");
    } else {
      console.error(err);
      res.status(500).json({ message: "Error adding deposit" });
    }
  });
});

// Edit deposit form
Router.get("/deposits/edit/:deposit_id", (req, res) => {
  const deposit_id = req.params.deposit_id;
  mysqlConnection.query("SELECT * FROM deposit WHERE deposit_id = ?", [deposit_id], (err, result) => {
    if (!err && result.length > 0) {
      res.render("editDeposit", { title: "Edit Deposit", deposit: result[0] });
    } else {
      res.status(404).json({ message: "Deposit not found" });
    }
  });
});

// Update deposit
Router.post("/deposits/edit/:deposit_id", (req, res) => {
  const deposit_id = req.params.deposit_id;
  const { amount, method, account } = req.body;
  const sql = `UPDATE deposit SET amount = ?, method = ?, account = ? WHERE deposit_id = ?`;
  mysqlConnection.query(sql, [amount, method, account, deposit_id], (err) => {
    if (!err) {
      res.redirect("/deposits");
    } else {
      console.error(err);
      res.status(500).json({ message: "Error updating deposit" });
    }
  });
});

// Delete deposit
Router.get("/deposits/delete/:deposit_id", (req, res) => {
  const deposit_id = req.params.deposit_id;
  mysqlConnection.query("DELETE FROM deposit WHERE deposit_id = ?", [deposit_id], (err) => {
    if (!err) {
      res.redirect("/deposits");
    } else {
      console.error(err);
      res.status(500).json({ message: "Error deleting deposit" });
    }
  });
});

///Lucky Order

// View all lucky orders
Router.get('/order', (req, res) => {
  mysqlConnection.query(`
    SELECT lo.*, s.username
    FROM lucky_orders lo
    JOIN signUp s ON lo.user_id = s.id
    ORDER BY lo.created_at DESC
  `, (err, results) => {
    if (!err) {
      res.render('order', { title: 'Lucky Orders', orders: results });
    } else {
      console.error(err);
      res.status(500).send('Error loading lucky orders');
    }
  });
});

// Show add form
Router.get('/order/add', (req, res) => {
  mysqlConnection.query(`SELECT id, username FROM signUp`, (err, users) => {
    if (!err) {
      res.render('addOrder', { title: 'Add Lucky Order', users });
    } else {
      res.status(500).send('Error loading users');
    }
  });
});

// Add lucky order
Router.post('/order/add', (req, res) => {
  const { user_id, order_number, is_claimed } = req.body;
  const sql = `
    INSERT INTO lucky_orders (user_id, order_number, is_claimed)
    VALUES (?, ?, ?)
  `;
  mysqlConnection.query(sql, [user_id, order_number, Number(is_claimed) ? 1 : 0], (err) => {
    if (!err) {
      res.redirect('/order');
    } else {
      console.error(err);
      res.status(500).send('Error adding lucky order');
    }
  });
});

// Edit form
Router.get('/order/edit/:id', (req, res) => {
  const id = req.params.id;
  mysqlConnection.query(`SELECT * FROM lucky_orders WHERE id = ?`, [id], (err, orderResult) => {
    if (err || orderResult.length === 0) return res.status(404).send('Lucky order not found');
    mysqlConnection.query(`SELECT id, username FROM signUp`, (err2, users) => {
      if (!err2) {
        res.render('editOrder', { title: 'Edit Lucky Order', order: orderResult[0], users });
      } else {
        res.status(500).send('Error loading users');
      }
    });
  });
});

// Update lucky order
Router.post('/order/edit/:id', (req, res) => {
  const { user_id, order_number, is_claimed } = req.body;
  const id = req.params.id;
  const sql = `
    UPDATE lucky_orders
    SET user_id = ?, order_number = ?, is_claimed = ?
    WHERE id = ?
  `;
  mysqlConnection.query(sql, [user_id, order_number, Number(is_claimed) ? 1 : 0, id], (err) => {
    if (!err) {
      res.redirect('/order');
    } else {
      console.error(err);
      res.status(500).send('Error updating lucky order');
    }
  });
});

// Delete lucky order
Router.post('/order/delete/:id', (req, res) => {
  const id = req.params.id;
  mysqlConnection.query(`DELETE FROM lucky_orders WHERE id = ?`, [id], (err) => {
    if (!err) {
      res.redirect('/order');
    } else {
      console.error(err);
      res.status(500).send('Error deleting lucky order');
    }
  });
});

// Simple dashboard route
Router.get('/dashboard', (req, res) => {
  // Get all data using callback style instead of async/await
  mysqlConnection.query('SELECT COUNT(*) as count FROM signUp', (err, userResult) => {
    if (err) {
      console.error('Error fetching users:', err);
      return res.render('dashboard', getErrorData());
    }

    mysqlConnection.query('SELECT COALESCE(SUM(amount), 0) as total FROM deposit', (err, depositResult) => {
      if (err) {
        console.error('Error fetching deposits:', err);
        return res.render('dashboard', getErrorData());
      }

      mysqlConnection.query('SELECT COALESCE(SUM(amount), 0) as total FROM withdrawals', (err, withdrawalResult) => {
        if (err) {
          console.error('Error fetching withdrawals:', err);
          return res.render('dashboard', getErrorData());
        }

        mysqlConnection.query('SELECT COUNT(*) as count FROM user_settings', (err, orderResult) => {
          if (err) {
            console.error('Error fetching orders:', err);
            return res.render('dashboard', getErrorData());
          }

          mysqlConnection.query('SELECT COALESCE(SUM(balance), 0) as total FROM signUp', (err, balanceResult) => {
            const dashboardData = {
              totalUsers: userResult[0].count,
              totalDeposits: depositResult[0].total,
              totalWithdrawals: withdrawalResult[0].total,
              totalOrders: orderResult[0].count,
              totalBalance: balanceResult[0].total,
              newUsersToday: 0,
              pendingDeposits: 0,
              pendingWithdrawals: 0,
              recentActivities: [
                {
                  icon: 'info-circle',
                  title: 'Dashboard loaded successfully',
                  time: new Date().toLocaleString()
                }
              ]
            };
            
            res.render('dashboard', dashboardData);
          });
        });
      });
    });
  });
});

function getErrorData() {
  return {
    totalUsers: 0,
    totalDeposits: 0,
    totalWithdrawals: 0,
    totalOrders: 0,
    newUsersToday: 0,
    pendingDeposits: 0,
    pendingWithdrawals: 0,
    totalBalance: 0,
    recentActivities: [
      {
        icon: 'exclamation-triangle',
        title: 'Error loading dashboard data',
        time: new Date().toLocaleString()
      }
    ]
  };
}


module.exports = Router;
