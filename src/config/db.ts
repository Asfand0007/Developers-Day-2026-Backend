import { PrismaClient } from '@prisma/client';
import dotenv from "dotenv";

dotenv.config();

// Use pooled connection (DATABASE_URL) at runtime to avoid exhausting DB connections in serverless.
// Limit to 1 connection per serverless instance so pgbouncer can pool effectively.
const rawUrl = process.env.DATABASE_URL;
const connectionLimit = process.env.VERCEL ? "1" : "5";
const datasourceUrl =
  rawUrl &&
  (rawUrl.includes("?")
    ? `${rawUrl}&connection_limit=${connectionLimit}`
    : `${rawUrl}?connection_limit=${connectionLimit}`);

const prisma = new PrismaClient(
  datasourceUrl
    ? {
        datasources: {
          db: { url: datasourceUrl },
        },
      }
    : undefined
);

const connectDB = async () => {
  try {
    await prisma.$connect();
    console.log("[database]: Connected to Supabase Postgres via Prisma successfully");

    // Ensure Row Level Security is enabled on all tables.
    // Skip when SKIP_RLS_SETUP=true (e.g. production where RLS is already
    // enabled via migrations) to avoid 13 extra DB round-trips on cold start.
    if (process.env.SKIP_RLS_SETUP === 'true') {
      console.log("[database]: Skipping RLS setup (SKIP_RLS_SETUP=true)");
    } else {
      const rlsTables = [
        'User',
        'Participant',
        'Competition',
        'Team',
        'TeamMember',
        'CompetitionAttendance',
        'StaffProfile',
        'Company',
        'FoodStall',
        'BrandAmbassador',
        'Category',
        'Venue',
        'UserAction',
      ];

      await Promise.all(
        rlsTables.map(async (table) => {
          try {
            await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`);
          } catch (err) {
            console.warn(`[database]: Failed to enable RLS on table "${table}"`, err);
          }
        })
      );
    }
  } catch (error) {
    console.error("[database]: Prisma connection failed", error);
    process.exit(1);
  }
};

const disconnectDB = async () => {
  await prisma.$disconnect();
};

export { prisma, connectDB, disconnectDB };
