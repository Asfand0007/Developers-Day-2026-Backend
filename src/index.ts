import express, { Request, Response } from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Connect to Database
import { connectDB, disconnectDB, prisma } from "./config/db";
connectDB();

app.use(express.json());

// Routes
import authRoutes from './routes/auth.routes'
import userRoutes from './routes/user.routes'
import registrationRoutes from './routes/registration.routes'
import competitionRoutes from './routes/competition.routes'
import ambassadorRoutes from './routes/ambassador.routes'
import participantRoutes from './routes/participant.routes'
app.use('/auth', authRoutes)
app.use('/users', userRoutes)
app.use('/registrations', registrationRoutes)
app.use('/competitions', competitionRoutes)
app.use('/ambassadors', ambassadorRoutes)
app.use('/participants', participantRoutes)

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
