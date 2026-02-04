import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import authRoutes from "./routes/authRoutes.js";
import inventoryRoutes from "./routes/inventoryRoutes.js";
import borrowRoutes from "./routes/borrowRoutes.js";
import reportRoutes from "./routes/reportRoutes.js";
import auditRoutes from "./routes/auditRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import returnRoutes from "./routes/returnRoutes.js";
import issuedRoutes from './routes/issuedRoutes.js';

dotenv.config();

const app = express();

/* ===============================
   MIDDLEWARE
================================ */
const allowedOrigins = [
  "https://invencea.netlify.app",
  "http://localhost:5173",
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // allow Postman / server-to-server
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
}));

app.use(express.json());

/* ===============================
   API ROUTES
================================ */
app.use("/api/auth", authRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/borrow-requests", borrowRoutes);
app.use("/api/borrow-requests", returnRoutes); // mounted on same base for legacy frontend
app.use("/api/reports", reportRoutes);
app.use("/api/audit-logs", auditRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use('/api', issuedRoutes);

/* ===============================
   HEALTH CHECK
================================ */
app.get("/", (req, res) => {
  res.json({ status: "Invencea Backend API running" });
});

/* ===============================
   404 HANDLER
================================ */
app.use((req, res) => {
  res.status(404).json({
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

/* ===============================
   START SERVER
================================ */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
