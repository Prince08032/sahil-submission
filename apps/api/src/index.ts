// apps/api/src/index.ts
import { createYoga } from "graphql-yoga";
import { createServer } from "http";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { createClient } from "@supabase/supabase-js";
import { typeDefs } from "./schema.js";
import { resolvers } from "./resolvers.js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
  console.error("Missing environment variables!");
  console.error(
    "Please ensure SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY are set in .env file"
  );
  process.exit(1);
}

console.log("Checking .env file: Found");
console.log("Env Debug ->");
console.log("SUPABASE_URL:", supabaseUrl);
console.log("ANON_KEY:", supabaseAnonKey ? "Loaded" : "Missing");
console.log("SERVICE_ROLE_KEY:", supabaseServiceKey ? "Loaded" : "Missing");

const schema = makeExecutableSchema({
  typeDefs,
  resolvers,
});

console.log("Schema compiled successfully");

const yoga = createYoga({
  schema,
  cors: {
    origin: [
      "http://localhost:3000",
      "http://localhost:5173",
      "https://sahil-submission-web.onrender.com",
    ],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Accept",
      "Origin",
      "X-Requested-With",
      "apollo-require-preflight",
      "x-user-id",
    ],
    // credentials: true, // Uncomment if needed for cookies/auth
  },
  context: async ({ request }) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "").trim();

    let userId: string | undefined = undefined;

    if (token) {
      try {
        const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey);
        const {
          data: { user },
          error,
        } = await supabaseAuth.auth.getUser(token);

        if (error) {
          console.warn("Auth verification error:", error.message);
        } else if (user) {
          userId = user.id;
        } else {
          console.warn("Token valid but no user found");
        }
      } catch (err) {
        console.error("Auth error:", err);
      }
    } else {
      console.log("No authorization token provided");
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
    });

    return {
      supabase,
      userId,
    };
  },
});

const server = createServer(yoga);

const PORT = Number(process.env.PORT || 4000);

server.listen(PORT, () => {
  console.log(`🚀 GraphQL API running on http://localhost:${PORT}/graphql`);
  console.log(`✅ Playground available at http://localhost:${PORT}/graphql`);
  console.log(`🔒 Auth middleware active`);
});
