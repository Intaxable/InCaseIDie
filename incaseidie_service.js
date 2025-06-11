// File: server.js
require("dotenv").config();
const express = require("express");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const cron = require("node-cron");
const bodyParser = require("body-parser");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

const USERS_DB = path.join(__dirname, "users.json");
if (!fs.existsSync(USERS_DB)) fs.writeFileSync(USERS_DB, "{}", "utf8");

// Encryption utils
const algorithm = "aes-256-cbc";
const key = crypto.createHash("sha256").update(process.env.ENCRYPTION_KEY).digest();

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

function decrypt(text) {
  const [ivHex, dataHex] = text.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const encrypted = Buffer.from(dataHex, "hex");
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

// Email setup
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SENDER_EMAIL,
    pass: process.env.SENDER_PASS,
  },
});

// Helpers
function loadUsers() {
  return JSON.parse(fs.readFileSync(USERS_DB));
}

function saveUsers(data) {
  fs.writeFileSync(USERS_DB, JSON.stringify(data, null, 2));
}

function sendCheckInEmail(email, name) {
  const msg = `Hi ${name || "there"},\n\nJust checking in — how are you doing today?\n\nReply to this email or click below to check in.`;
  transporter.sendMail({
    from: `In Case I Die <${process.env.SENDER_EMAIL}>`,
    to: email,
    subject: "How are you?",
    text: msg,
  });
}

// Cron job — run every day at 10am
cron.schedule("0 10 * * *", () => {
  const users = loadUsers();
  const now = Date.now();
  Object.entries(users).forEach(([id, user]) => {
    if (user.nextCheck <= now) {
      sendCheckInEmail(decrypt(user.email), user.name);
      users[id].nextCheck = now + 1000 * 60 * 60 * 24 * (user.frequency || 1);
    }
  });
  saveUsers(users);
});

// Create user (payment already handled elsewhere)
app.post("/register", (req, res) => {
  const { email, name, frequency = 1 } = req.body;
  const id = crypto.randomUUID();
  const users = loadUsers();
  users[id] = {
    email: encrypt(email),
    name,
    frequency,
    nextCheck: Date.now() + 1000 * 60 * 60 * 24 * frequency,
  };
  saveUsers(users);
  res.json({ success: true, id });
});

// Update email or check-in frequency
app.post("/update", (req, res) => {
  const { id, email, frequency } = req.body;
  const users = loadUsers();
  if (!users[id]) return res.status(404).json({ error: "User not found" });
  if (email) users[id].email = encrypt(email);
  if (frequency) users[id].frequency = frequency;
  saveUsers(users);
  res.json({ success: true });
});

app.get("/", (req, res) => {
  res.send("In Case I Die – Check-in API is live");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
