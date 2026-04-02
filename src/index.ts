import express, { Request, Response } from "express";
import dotenv from "dotenv";
import cors from "cors";
import rateLimit from "express-rate-limit";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Connect to Databas
import { connectDB, disconnectDB, prisma } from "./config/db";
connectDB();

const frontendOrigin = process.env.FRONTEND_ORIGIN || process.env.FRONTEND_URL;

const allowedOrigins: string[] = [];
if (frontendOrigin) {
  frontendOrigin
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean)
    .forEach((o) => allowedOrigins.push(o));
}
// Allow localhost for local development
allowedOrigins.push("http://localhost:3000", "http://127.0.0.1:3000");

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. Postman, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // Allow any origin when FRONTEND_URL is not set (dev fallback)
    if (!frontendOrigin) return callback(null, true);
    callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept"],
};

app.use(cors(corsOptions));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

app.use(express.json());

// Request timing (logs method, path, status, duration)
import { requestTiming } from './middleware/timing'
app.use(requestTiming)

// Routes
import authRoutes from './routes/auth.routes'
import userRoutes from './routes/user.routes'
import registrationRoutes from './routes/registration.routes'
import competitionRoutes from './routes/competition.routes'
import ambassadorRoutes from './routes/ambassador.routes'
import participantRoutes from './routes/participant.routes'
import webRegistrationRoutes from './routes/web-registration.routes'
app.use('/auth', authRoutes)
app.use('/users', userRoutes)
app.use('/registrations', registrationRoutes)
app.use('/competitions', competitionRoutes)
app.use('/ambassadors', ambassadorRoutes)
app.use('/participants', participantRoutes)
app.use('/public/registrations', webRegistrationRoutes)

app.get("/", (_req: Request, res: Response) => {
  res.send("Express + TypeScript Server");
});

// Example route to test Prisma
app.get("/users", async (_req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany();
    res.json(users);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await disconnectDB();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  await disconnectDB();
  process.exit(0);
});

app.listen(port, () => {
  console.log(`[server]: Server is running at http://localhost:${port}`);
});
