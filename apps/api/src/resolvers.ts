import "dotenv/config";
import { GraphQLError } from "graphql";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_").trim();
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
}

const supabase = createClient(supabaseUrl, supabaseKey);

interface Context {
  userId?: string;
}

function requireAuth(ctx: Context) {
  if (!ctx.userId) {
    throw new GraphQLError("Unauthorized", {
      extensions: { code: "UNAUTHENTICATED" },
    });
  }
  return ctx.userId;
}

const urlAccessCache = new Map<
  string,
  { userId: string; assetId: string; expiresAt: number }
>();

setInterval(() => {
  const now = Date.now();
  for (const [token, data] of urlAccessCache.entries()) {
    if (data.expiresAt < now) {
      urlAccessCache.delete(token);
    }
  }
}, 60000);

export const resolvers = {
  Query: {
    me: async (_: any, __: any, ctx: Context) => {
      const userId = requireAuth(ctx);
      const { data, error } = await supabase
        .from("users")
        .select("id, email, created_at")
        .eq("id", userId)
        .single();
      if (error) throw error;
      return data;
    },

    myAssets: async (
      _: any,
      args: { after?: string; first?: number; q?: string },
      ctx: Context
    ) => {
      const userId = requireAuth(ctx);
      const limit = args.first || 50;
      let query = supabase
        .from("asset")
        .select("*")
        .eq("owner_id", userId)
        .order("created_at", { ascending: false });

      if (args.q) {
        query = query.ilike("filename", `%${args.q}%`);
      }

      if (args.after) {
        query = query.gt("created_at", args.after);
      }

      query = query.limit(limit + 1);
      const { data, error } = await query;
      if (error) throw error;
      const assets = data || [];
      const hasNextPage = assets.length > limit;
      const nodes = hasNextPage ? assets.slice(0, limit) : assets;

      return {
        edges: nodes.map((asset: any) => ({
          cursor: asset.created_at,
          node: {
            id: asset.id,
            filename: asset.filename,
            mime: asset.mime,
            size: asset.size,
            sha256: asset.sha256,
            status: asset.status,
            version: asset.version,
            createdAt: asset.created_at,
            updatedAt: asset.updated_at,
          },
        })),
        pageInfo: {
          endCursor:
            nodes.length > 0 ? nodes[nodes.length - 1].created_at : null,
          hasNextPage,
        },
      };
    },

    listAssets: async (_: any, __: any, ctx: Context) => {
      const userId = requireAuth(ctx);
      const { data, error } = await supabase
        .from("asset")
        .select("*")
        .eq("owner_id", userId);
      if (error) throw error;
      return data || [];
    },

    getDownloadUrl: async (_: any, { assetId }: any, ctx: Context) => {
      const userId = requireAuth(ctx);
      const { data: asset, error: assetError } = await supabase
        .from("asset")
        .select("*")
        .eq("id", assetId)
        .single();
      if (assetError) throw assetError;
      if (!asset) {
        throw new GraphQLError("Asset not found", {
          extensions: { code: "NOT_FOUND" },
        });
      }
      if (asset.owner_id !== userId) {
        const { data: sharedAccess, error: shareError } = await supabase
          .from("asset_share")
          .select("*")
          .eq("asset_id", assetId)
          .eq("to_user", userId)
          .eq("can_download", true)
          .maybeSingle();
        if (shareError) throw shareError;
        if (!sharedAccess) {
          throw new GraphQLError("Access denied", {
            extensions: { code: "FORBIDDEN" },
          });
        }
      }
      const { data: urlData, error: urlError } = await supabase.storage
        .from("private-media")
        .createSignedUrl(asset.storage_path, 90);
      if (urlError) throw urlError;
      const accessToken = crypto.randomBytes(32).toString("hex");
      const expiresAt = Date.now() + 90 * 1000;
      urlAccessCache.set(accessToken, { userId, assetId, expiresAt });
      await supabase.from("download_audit").insert({
        id: crypto.randomUUID(),
        asset_id: assetId,
        user_id: userId,
        at: new Date().toISOString(),
      });
      const secureUrl = `${urlData.signedUrl}&access_token=${accessToken}`;
      return { url: secureUrl, expiresAt: new Date(expiresAt).toISOString() };
    },

    validateDownloadToken: async (
      _: any,
      { accessToken }: { accessToken: string },
      ctx: Context
    ) => {
      const userId = requireAuth(ctx);
      const cached = urlAccessCache.get(accessToken);
      if (!cached) {
        throw new GraphQLError("Invalid or expired access token", {
          extensions: { code: "FORBIDDEN" },
        });
      }
      if (cached.userId !== userId) {
        throw new GraphQLError("Access denied", {
          extensions: { code: "FORBIDDEN" },
        });
      }
      if (cached.expiresAt < Date.now()) {
        urlAccessCache.delete(accessToken);
        throw new GraphQLError("Token expired", {
          extensions: { code: "FORBIDDEN" },
        });
      }
      urlAccessCache.delete(accessToken);
      return { valid: true, assetId: cached.assetId };
    },
  },

  Mutation: {
    createUploadUrl: async (_: any, { filename, mime, size }: any, ctx: Context) => {
      const userId = requireAuth(ctx);
      const ALLOWED_MIMES = [
        "image/jpeg",
        "image/png",
        "image/webp",
        "application/pdf",
      ];
      if (!ALLOWED_MIMES.includes(mime)) {
        throw new GraphQLError(`Unsupported file type: ${mime}`, {
          extensions: { code: "BAD_REQUEST" },
        });
      }
      const sanitizedFilename = sanitizeFilename(filename);
      const assetId = crypto.randomUUID();
      const storagePath = `${userId}/${assetId}/${sanitizedFilename}`;
      const nonce = crypto.randomBytes(16).toString("hex");
      const { error: assetError } = await supabase.from("asset").insert({
        id: assetId,
        owner_id: userId,
        filename,
        mime,
        size,
        storage_path: storagePath,
        status: "draft",
        version: 1,
      });
      if (assetError) throw assetError;
      const { error: ticketError } = await supabase.from("upload_ticket").insert({
        asset_id: assetId,
        user_id: userId,
        storage_path: storagePath,
        mime,
        size,
        used: false,
        nonce,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      });
      if (ticketError) throw ticketError;
      const { data: signed, error: urlError } = await supabase.storage
        .from("private-media")
        .createSignedUploadUrl(storagePath);
      if (urlError) throw urlError;
      return {
        assetId,
        storagePath,
        uploadUrl: signed.signedUrl,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        nonce,
        version: 1,
      };
    },

    finalizeUpload: async (_: any, { assetId, clientSha256, version }: any, ctx: Context) => {
      const userId = requireAuth(ctx);
      const { data: ticket, error: ticketError } = await supabase
        .from("upload_ticket")
        .select("*")
        .eq("asset_id", assetId)
        .eq("user_id", userId)
        .eq("used", false)
        .single();
      if (ticketError || !ticket)
        throw new GraphQLError("Invalid or used upload ticket", {
          extensions: { code: "INVALID_TICKET" },
        });
      await supabase.from("upload_ticket").update({ used: true }).eq("asset_id", assetId);
      const status = clientSha256 ? "ready" : "corrupt";
      const { data: asset, error: assetError } = await supabase
        .from("asset")
        .update({
          sha256: clientSha256,
          status,
          version,
        })
        .eq("id", assetId)
        .select("*")
        .single();
      if (assetError) throw assetError;
      return {
        id: asset.id,
        filename: asset.filename,
        mime: asset.mime,
        size: asset.size,
        sha256: asset.sha256,
        status: asset.status,
        version: asset.version,
        createdAt: asset.created_at,
        updatedAt: asset.updated_at,
      };
    },

    renameAsset: async (_: any, { assetId, filename, version }: any, ctx: Context) => {
      const userId = requireAuth(ctx);
      const { data: asset, error } = await supabase
        .from("asset")
        .update({
          filename,
          version: version + 1,
        })
        .eq("id", assetId)
        .eq("owner_id", userId)
        .eq("version", version)
        .select("*")
        .single();
      if (error) {
        if (error.code === "PGRST116") {
          throw new GraphQLError("Version conflict", {
            extensions: { code: "CONFLICT" },
          });
        }
        throw error;
      }
      return {
        id: asset.id,
        filename: asset.filename,
        mime: asset.mime,
        size: asset.size,
        sha256: asset.sha256,
        status: asset.status,
        version: asset.version,
        createdAt: asset.created_at,
        updatedAt: asset.updated_at,
      };
    },

    deleteAsset: async (_: any, { assetId, version }: any, ctx: Context) => {
      const userId = requireAuth(ctx);
      const { data: asset, error: fetchError } = await supabase
        .from("asset")
        .select("*")
        .eq("id", assetId)
        .eq("owner_id", userId)
        .eq("version", version)
        .single();
      if (fetchError) throw fetchError;
      await supabase.storage.from("private-media").remove([asset.storage_path]);
      const { error: deleteError } = await supabase
        .from("asset")
        .delete()
        .eq("id", assetId)
        .eq("owner_id", userId);
      if (deleteError) throw deleteError;
      return true;
    },

    shareAsset: async (_: any, { assetId, toEmail, canDownload, version }: any, ctx: Context) => {
      const userId = requireAuth(ctx);
      const { data: asset, error: assetError } = await supabase
        .from("asset")
        .select("*")
        .eq("id", assetId)
        .eq("owner_id", userId)
        .eq("version", version)
        .single();
      if (assetError) throw assetError;
      const { data: targetUser, error: userError } = await supabase
        .from("users")
        .select("id")
        .eq("email", toEmail)
        .single();
      if (userError || !targetUser)
        throw new GraphQLError("User not found", {
          extensions: { code: "NOT_FOUND" },
        });
      const { data, error } = await supabase
        .from("asset_share")
        .upsert({
          id: crypto.randomUUID(),
          asset_id: assetId,
          to_user: targetUser.id,
          can_download: canDownload,
          created_at: new Date().toISOString(),
        })
        .select("*")
        .single();
      if (error) throw error;
      return {
        success: true,
        message: "Asset shared successfully",
        share: {
          id: data.id,
          asset_id: data.asset_id,
          owner_id: asset.owner_id,
          shared_with_email: toEmail,
          can_download: data.can_download,
          revoked: false,
          created_at: data.created_at,
        },
      };
    },

    revokeShare: async (_: any, { assetId, toEmail, version }: any, ctx: Context) => {
      const userId = requireAuth(ctx);
      const { error: assetError } = await supabase
        .from("asset")
        .select("id")
        .eq("id", assetId)
        .eq("owner_id", userId)
        .eq("version", version)
        .single();
      if (assetError) throw assetError;
      const { data: targetUser, error: userError } = await supabase
        .from("users")
        .select("id")
        .eq("email", toEmail)
        .single();
      if (userError || !targetUser)
        throw new GraphQLError("User not found", {
          extensions: { code: "NOT_FOUND" },
        });
      const { error } = await supabase
        .from("asset_share")
        .delete()
        .eq("asset_id", assetId)
        .eq("to_user", targetUser.id);
      if (error) throw error;
      return { success: true, message: "Share revoked successfully", share: null };
    },
  },
};
