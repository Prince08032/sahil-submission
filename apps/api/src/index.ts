// apps/api/src/index.ts
import { createYoga } from 'graphql-yoga';
import { createServer } from 'http';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { createClient } from '@supabase/supabase-js';
import { typeDefs } from './schema.js';
import { resolvers } from './resolvers.js';
import dotenv from 'dotenv';

dotenv.config();


const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing environment variables!');
  console.error('Please ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in .env file');
  process.exit(1);
}

console.log('Checking .env file: Found');
console.log('Env Debug ->');
console.log('SUPABASE_URL:', supabaseUrl);
console.log('SERVICE_ROLE_KEY:', supabaseServiceKey ? 'Loaded' : 'Missing');


const schema = makeExecutableSchema({
  typeDefs,
  resolvers
});

console.log('Schema compiled successfully');

const yoga = createYoga({
  schema,
  context: async ({ request }) => {
 
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '').trim();
    
    let userId: string | undefined = undefined; 
    
  
    if (token) {
      try {
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        const { data: { user }, error } = await supabase.auth.getUser(token);
        
        if (error) {
          
        } else if (user) {
          userId = user.id;
       
        } else {
          console.warn('Token valid but no user found');
        }
      } catch (err) {
        console.error('Auth error:', err);
      }
    } else {
      console.log('No authorization token provided'); 
    }
    
    // 3️⃣ Create user-scoped client
    const supabase = token 
      ? createClient(supabaseUrl, supabaseServiceKey, {
          global: {
            headers: {
              Authorization: `Bearer ${token}`
            }
          }
        })
      : createClient(supabaseUrl, supabaseServiceKey);
    
    return {
      supabase,
      userId 
    };
  },
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true
  }
});

const server = createServer(yoga);

const PORT = process.env.PORT || 4000;

server.listen(PORT, () => {
  console.log(`GraphQL API running on http://localhost:${PORT}/graphql`);
  console.log(`Playground available at http://localhost:${PORT}/graphql`);
  console.log(`Auth middleware active`);
});

