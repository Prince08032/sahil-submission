# 🔒 Secure Media Vault

A secure, authenticated media management system built with React, GraphQL, and Supabase.

## 📋 Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Project Setup](#project-setup)
- [Supabase Configuration](#supabase-configuration)
- [Environment Variables](#environment-variables)
- [Local Development](#local-development)
- [Testing](#testing)
- [Demo Video](#demo-video)
- [Architecture](#architecture)

---

## ✨ Features

- ✅ Secure user authentication (sign up/sign in)
- ✅ File upload with client-side SHA-256 verification
- ✅ Private storage with Row-Level Security (RLS)
- ✅ Signed download URLs with expiration
- ✅ File management (rename, delete)
- ✅ Offline support with queued operations
- ✅ Real-time upload progress tracking
- ✅ Optimistic concurrency control (version tracking)

---

## 📦 Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js**: v18.x or higher
  ```bash
  node --version  # Should be 18.x or higher
  ```

- **PNPM**: v8.x or higher (recommended) or NPM v9.x
  ```bash
  npm install -g pnpm
  pnpm --version
  ```

- **Git**: Latest version
  ```bash
  git --version
  ```

- **Supabase Account**: Sign up at [supabase.com](https://supabase.com)

- **Supabase CLI** (for Edge Functions):
  ```bash
  npm install -g supabase
  supabase --version
  ```

---

## 🚀 Project Setup

### 1. Clone the Repository

```bash
git clone <your-repo-url>
cd secure-media-vault
```

### 2. Install Dependencies

```bash
# Install all workspace dependencies
pnpm install

# Or if using npm
npm install
```

### 3. Project Structure

```
secure-media-vault/
├── apps/
│   ├── web/              # React frontend (Vite)
│   │   ├── src/
│   │   ├── .env.example
│   │   └── package.json
│   ├── api/              # GraphQL API (Yoga)
│   │   ├── src/
│   │   ├── .env.example
│   │   └── package.json
├── supabase/
│   ├── functions/
│   │   └── hash-object/  # Edge Function for SHA-256
│   ├── migrations/       # Database migrations
│   └── config.toml
├── package.json          # Root workspace config
└── README.md
```

---

## 🗄️ Supabase Configuration

### Step 1: Create Supabase Project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard)
2. Click **"New Project"**
3. Fill in:
   - **Project Name**: `secure-media-vault`
   - **Database Password**: (save this securely)
   - **Region**: Choose closest to you
4. Click **"Create new project"**
5. Wait for project to finish setting up (~2 minutes)

### Step 2: Get Your Credentials

From your Supabase project dashboard:

1. Go to **Settings** → **API**
2. Copy these values:
   - **Project URL** (e.g., `https://xxxxx.supabase.co`)
   - **anon public** key
   - **service_role** key (⚠️ keep this secret!)

### Step 3: Run Database Migrations

```bash
cd supabase

# Login to Supabase CLI
supabase login

# Link to your project
supabase link --project-ref <your-project-ref>

# Run migrations
supabase db push
```

Or manually run these SQL scripts in **SQL Editor**:

#### Create Tables

```sql
-- Users table (managed by Supabase Auth)

-- Assets table
CREATE TABLE asset (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  sha256 TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft', 'ready', 'corrupt', 'error')),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_asset_owner ON asset(owner_id);
CREATE INDEX idx_asset_status ON asset(status);

-- Upload tickets table
CREATE TABLE upload_ticket (
  asset_id UUID PRIMARY KEY REFERENCES asset(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  nonce TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Asset sharing table
CREATE TABLE asset_share (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
  to_user UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  can_download BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(asset_id, to_user)
);

-- Download audit log
CREATE TABLE download_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_download_audit_asset ON download_audit(asset_id);
CREATE INDEX idx_download_audit_user ON download_audit(user_id);

-- Enable Row Level Security
ALTER TABLE asset ENABLE ROW LEVEL SECURITY;
ALTER TABLE upload_ticket ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_share ENABLE ROW LEVEL SECURITY;
ALTER TABLE download_audit ENABLE ROW LEVEL SECURITY;

-- RLS Policies for asset table
CREATE POLICY "Users can view own assets"
  ON asset FOR SELECT
  TO authenticated
  USING (owner_id = auth.uid());

CREATE POLICY "Users can insert own assets"
  ON asset FOR INSERT
  TO authenticated
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Users can update own assets"
  ON asset FOR UPDATE
  TO authenticated
  USING (owner_id = auth.uid());

CREATE POLICY "Users can delete own assets"
  ON asset FOR DELETE
  TO authenticated
  USING (owner_id = auth.uid());

-- RLS Policies for upload_ticket
CREATE POLICY "Users can manage own tickets"
  ON upload_ticket FOR ALL
  TO authenticated
  USING (user_id = auth.uid());

-- RLS Policies for asset_share
CREATE POLICY "Users can view shares for own assets"
  ON asset_share FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM asset WHERE asset.id = asset_share.asset_id AND asset.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can create shares for own assets"
  ON asset_share FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM asset WHERE asset.id = asset_share.asset_id AND asset.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete shares for own assets"
  ON asset_share FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM asset WHERE asset.id = asset_share.asset_id AND asset.owner_id = auth.uid()
    )
  );
```

### Step 4: Create Storage Bucket

1. Go to **Storage** in Supabase dashboard
2. Click **"New bucket"**
3. Settings:
   - **Name**: `private-media`
   - **Public bucket**: ❌ OFF (must be private)
   - **File size limit**: 50 MB
   - **Allowed MIME types**: `image/jpeg, image/png, image/webp, application/pdf`
4. Click **"Create bucket"**

### Step 5: Configure Storage RLS

Go to **Storage** → **Policies** → Click on `private-media` bucket:

#### Policy 1: SELECT (Download)
```sql
-- Name: Users can download own files
-- Operation: SELECT
-- Policy:
(storage.foldername(name))[1] = auth.uid()::text
```

#### Policy 2: INSERT (Upload)
```sql
-- Name: Users can upload to own folder
-- Operation: INSERT
-- Policy:
(storage.foldername(name))[1] = auth.uid()::text
```

#### Policy 3: UPDATE
```sql
-- Name: Users can update own files
-- Operation: UPDATE
-- Policy:
(storage.foldername(name))[1] = auth.uid()::text
```

#### Policy 4: DELETE
```sql
-- Name: Users can delete own files
-- Operation: DELETE
-- Policy:
(storage.foldername(name))[1] = auth.uid()::text
```

### Step 6: Deploy Edge Function (Optional - for server-side SHA-256)

```bash
cd supabase

# Deploy the hash-object function
supabase functions deploy hash-object

# Set environment variables for the function
supabase secrets set SUPABASE_URL=<your-supabase-url>
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
```

**Note**: The current implementation uses client-side SHA-256 hashing, so this Edge Function is optional but included for completeness.

---

## 🔐 Environment Variables

### Frontend (.env file location: `apps/web/.env`)

Create `apps/web/.env` from the example:

```bash
cp apps/web/.env.example apps/web/.env
```

Edit `apps/web/.env`:

```env
# Supabase Configuration
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here

# API URL (GraphQL server)
VITE_API_URL=http://localhost:4000/graphql
```

**Where to find these:**
- `VITE_SUPABASE_URL`: Supabase Dashboard → Settings → API → Project URL
- `VITE_SUPABASE_ANON_KEY`: Supabase Dashboard → Settings → API → Project API keys → anon public

### Backend (.env file location: `apps/api/.env`)

Create `apps/api/.env` from the example:

```bash
cp apps/api/.env.example apps/api/.env
```

Edit `apps/api/.env`:

```env
# Supabase Configuration
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# Server Configuration
PORT=4000
CORS_ORIGIN=http://localhost:5173

# Node Environment
NODE_ENV=development
```

**Where to find these:**
- `SUPABASE_URL`: Same as frontend
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase Dashboard → Settings → API → Project API keys → service_role (⚠️ Secret!)

### Edge Function (.env file location: `supabase/functions/hash-object/.env`)

```env
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

---

## 💻 Local Development

### Start Both Services (Recommended)

From the root directory:

```bash
# Start both web and api concurrently
pnpm dev

# Or with npm
npm run dev
```

This will start:
- 🌐 **Frontend**: http://localhost:5173
- 🔌 **API**: http://localhost:4000/graphql

### Start Services Individually

**Terminal 1 - Backend API:**
```bash
cd apps/api
pnpm dev
# Server runs on http://localhost:4000/graphql
```

**Terminal 2 - Frontend:**
```bash
cd apps/web
pnpm dev
# App runs on http://localhost:5173
```

### Build for Production

```bash
# Build all apps
pnpm build

# Build specific app
cd apps/web
pnpm build

cd apps/api
pnpm build
```

---

## 🧪 Testing

### Run All Tests

```bash
# From root directory
pnpm test

# Or with npm
npm test
```

### What's Covered

The test suite includes:

1. **Authentication Tests**
   - User sign up
   - User sign in
   - Session management
   - Token validation

2. **Upload Tests**
   - File upload flow
   - SHA-256 computation
   - Upload ticket validation
   - Finalization process

3. **Asset Management Tests**
   - List user assets
   - Rename assets
   - Delete assets
   - Version conflict handling

4. **Security Tests**
   - RLS policies enforcement
   - Cross-user access prevention
   - Download URL authorization

5. **Download Tests**
   - Signed URL generation
   - URL expiration
   - Access control

### Manual Testing Checklist

✅ **Test 1: Sign Up**
- Open http://localhost:5173
- Click "Sign Up"
- Enter email and password
- Verify success message

✅ **Test 2: Sign In**
- Sign in with created credentials
- Verify redirect to dashboard

✅ **Test 3: Upload File**
- Drag and drop a file or use "Choose Files"
- Verify progress bar
- Verify SHA-256 computation
- Verify file appears in asset list

✅ **Test 4: Download Link**
- Click "Copy Link" on any asset
- Verify link is copied
- Verify expiration countdown

✅ **Test 5: Rename Asset**
- Click rename icon
- Enter new name
- Verify name updates

✅ **Test 6: Delete Asset**
- Click delete icon
- Confirm deletion
- Verify asset removed

✅ **Test 7: Cross-User Security**
- Login as User A, copy download link
- Logout and login as User B
- Paste User A's link → Should fail (403/404)

✅ **Test 8: Offline Support**
- Upload a file
- Disconnect network during upload
- Verify queued status
- Reconnect → verify auto-finalization

---

## 🎥 Demo Video

**Watch the 3-minute demo**: [YouTube/Loom Link Here]

The demo covers all 8 acceptance criteria:
1. User authentication (sign up/sign in)
2. File upload with progress
3. SHA-256 verification
4. Asset listing
5. Download URL generation
6. File management (rename/delete)
7. Cross-user security validation
8. Offline handling

---

## 🏗️ Architecture

### Tech Stack

**Frontend:**
- React 18 with TypeScript
- Vite for build tooling
- TailwindCSS for styling
- Lucide React for icons
- Supabase JS Client

**Backend:**
- GraphQL Yoga (GraphQL server)
- Node.js with TypeScript
- Supabase for database & storage
- Express-like HTTP server

**Database & Storage:**
- PostgreSQL (via Supabase)
- Supabase Storage with RLS
- Row-Level Security policies

### Security Features

1. **Authentication**: JWT-based auth via Supabase
2. **Authorization**: Row-Level Security on all tables
3. **Storage Security**: Private buckets with RLS policies
4. **Download URLs**: Time-limited signed URLs (60s expiry)
5. **Data Integrity**: Client-side SHA-256 verification
6. **Version Control**: Optimistic concurrency with version tracking

### File Upload Flow

```
1. Client requests upload ticket (GraphQL mutation)
   ↓
2. Server creates asset record + upload ticket
   ↓
3. Server generates signed upload URL
   ↓
4. Client uploads file directly to Supabase Storage
   ↓
5. Client computes SHA-256 hash
   ↓
6. Client finalizes upload with hash (GraphQL mutation)
   ↓
7. Server verifies and marks asset as "ready"
```

### Download Flow

```
1. Client requests download URL (GraphQL query)
   ↓
2. Server checks ownership/permissions
   ↓
3. Server generates signed URL (60s expiry)
   ↓
4. Client receives URL and copies to clipboard
   ↓
5. RLS policies enforce access when URL is used
```

---

## 🐛 Troubleshooting

### Common Issues

**Issue**: "No active session"
- **Solution**: Ensure you're logged in. Check browser console for auth errors.

**Issue**: "Unauthorized" on GraphQL requests
- **Solution**: Verify `VITE_SUPABASE_ANON_KEY` is correct in `apps/web/.env`

**Issue**: Upload fails with 403
- **Solution**: Check storage RLS policies are configured correctly

**Issue**: Cannot see uploaded files
- **Solution**: Ensure asset table RLS policies allow SELECT for owner

**Issue**: Cross-user access works (security breach!)
- **Solution**: Verify storage RLS policies are enabled and correct

**Issue**: API won't start
- **Solution**: Check `SUPABASE_SERVICE_ROLE_KEY` in `apps/api/.env`



Backend logs:
```bash
cd apps/api
pnpm dev
# Watch terminal for authentication and request logs
```

---


**Built with ❤️ using React, GraphQL, and Supabase**
